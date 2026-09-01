import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../../utils/jwt";
import { MESSAGES } from "../../utils/statusConstant";

const prisma = new PrismaClient();
const NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
};
const safeUserSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    countryCode: true,
    gstn: true,
    status: true,
};

// 📌 GET /api/orders?page=1&limit=10&sortBy=createdAt&order=desc&status=PENDING
export async function GET(request) {
    try {
        const payload = await authenticate(request);
        if (!payload) {
            return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
        }
        const isAdmin = await verifyAdmin(request);
        const authenticatedUserId = Number(payload.userId);
        const { searchParams } = new URL(request.url);
        const email = searchParams.get('email');
        const id = Number(searchParams.get('userId'));
        const orderId = Number(searchParams.get('orderId'));
        if (orderId) {
            const orders = await prisma.order.findFirst({
                where: {
                    id: Number(orderId),
                    ...(!isAdmin ? { userId: authenticatedUserId } : {}),
                },
                include: {
                    user: { select: safeUserSelect },
                    items: {
                        include: {
                            product: true, // 👈 this includes product details inside each item
                        },
                    },
                    shipping: true,
                    payment: true,
                },
            });
            if (!orders) {
                return NextResponse.json({ error: "Order not found" }, { status: 404 });
            }
            const tax = await prisma.tax.findMany();
            const deliveryAgent = isAdmin ? await prisma.deliveryAgent.findMany() : [];
            return NextResponse.json(
                { data: orders, tax, deliveryAgent },
                { status: 200, headers: NO_STORE_HEADERS }
            );
        }

        let requestedUserId = authenticatedUserId;
        if (isAdmin) {
            if (!email && !id) {
                return NextResponse.json({ error: "userID or email is missing!" }, { status: 400 });
            }
            if (email) {
                const userDetails = await prisma.user.findUnique({
                    where: { email },
                    select: { id: true },
                });
                if (!userDetails) {
                    return NextResponse.json({ error: "User not found" }, { status: 404 });
                }
                requestedUserId = userDetails.id;
            } else {
                requestedUserId = id;
            }
        }
        const orders = await prisma.order.findMany({
            where: {
                userId: requestedUserId,
            },
            include: {
                user: { select: safeUserSelect },
                items: {
                    include: {
                        product: true, // 👈 this includes product details inside each item
                    },
                },
                shipping: true,
                payment: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        const tax = await prisma.tax.findMany();
        const deliveryAgent = isAdmin ? await prisma.deliveryAgent.findMany() : [];
        return NextResponse.json(
            { data: orders, tax, deliveryAgent },
            { status: 200, headers: NO_STORE_HEADERS }
        );
    } catch (err) {
        console.error("GET /orders/filter error:", err);
        return NextResponse.json({ error: MESSAGES.SERVER_ERROR }, { status: 500 });
    }
}

export async function PUT(request) {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));
    const { status, deliveryAgentAssets, delivered } = await request.json();
    try {
        if (await verifyAdmin(request)) {
            if (deliveryAgentAssets && delivered) {
                let orderUpdate = await prisma.order.update({ where: { id: id }, data: { status: status, deliveryAgentAssets: deliveryAgentAssets } })
                return NextResponse.json({ msg: "Order: " + id + " " + status + " successfully!" }, { status: 200 });
            }
            let orderUpdate = await prisma.order.update({ where: { id: id }, data: { status: status } })
            return NextResponse.json({ msg: "Order status: " + status + " updated successfully!" }, { status: 200 });
        }
        return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 403 });
    } catch (err) {
        console.log('...........err', err);
        return NextResponse.json({ error: MESSAGES.SERVER_ERROR }, { status: 500 });
    }
}
