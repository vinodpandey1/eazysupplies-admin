import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyAdmin, authenticate } from "../utils/jwt";
import { MESSAGES } from "../utils/statusConstant";
import { generateOrderSummaryHTML, generateApprovedOrderSummaryHTML, sendEmail, sendWhatsAppOrderCreate } from "../utils/emailUtils";
import { createNotification } from "../utils/emailUtils";
import { generateInvoicePdf } from "../utils/pdfUtils";
import { convertDate, calcDate } from "../utils/dateUtils";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const recentRequests = new Map();
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
    if (!payload?.userId) {
      return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
    }
    const isAdmin = await verifyAdmin(request);
    const { searchParams } = new URL(request.url);

    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(searchParams.get("paginate") || searchParams.get("limit")) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const allowedSortFields = new Set(["createdAt", "updatedAt", "status", "id"]);
    const requestedSort = searchParams.get("sortBy");
    const sortBy = allowedSortFields.has(requestedSort) ? requestedSort : "createdAt";
    const order = searchParams.get("order") === "asc" ? "asc" : "desc";

    const status = searchParams.get("status");
    const where = {
      ...(!isAdmin ? { userId: Number(payload.userId) } : {}),
      ...(status ? { status } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: order },
        include: {
          user: { select: safeUserSelect },
          items: { include: { product: true } },
          shipping: true,
          payment: true,
        },
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json({
      page,
      current_page: page,
      limit,
      per_page: limit,
      total,
      totalPages: Math.ceil(total / limit),
      last_page: Math.ceil(total / limit),
      orders,
      data: orders,
    });
  } catch (error) {
    console.error("GET /orders error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

// 📌 POST /api/orders
export async function POST(request) {
  try {
    const authenticatedPayload = await authenticate(request);

    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey && recentRequests.has(idempotencyKey)) {
      return NextResponse.json(recentRequests.get(idempotencyKey), { status: 200 });
    }

    const body = await request.json();
    const { shipping, payment, jsonData, guest } = body;
    let payload = authenticatedPayload;

    if (!payload?.userId) {
      const guestName = String(guest?.name || "").trim();
      const guestEmail = String(guest?.email || "").trim().toLowerCase();
      const guestPhone = String(guest?.phone || "").replace(/\D/g, "");
      const guestCountryCode = String(guest?.countryCode || "91").replace(/\D/g, "") || "91";
      if (!guestName || !/^\S+@\S+\.\S+$/.test(guestEmail) || !/^[6-9]\d{9}$/.test(guestPhone)) {
        return NextResponse.json({ error: "Please provide a valid guest name, email and 10-digit phone number." }, { status: 400 });
      }

      const [emailUser, phoneUser] = await Promise.all([
        prisma.user.findUnique({ where: { email: guestEmail } }),
        prisma.user.findUnique({ where: { phone: guestPhone } }),
      ]);
      if (emailUser && phoneUser && emailUser.id !== phoneUser.id) {
        return NextResponse.json({ error: "The email and phone number belong to different accounts. Please log in or use different details." }, { status: 409 });
      }

      let guestUser = emailUser || phoneUser;
      if (!guestUser) {
        const role = (await prisma.role.findUnique({ where: { name: "customer" } })) ||
          (await prisma.role.create({ data: { name: "customer" } }));
        guestUser = await prisma.user.create({
          data: {
            name: guestName,
            email: guestEmail,
            phone: guestPhone,
            countryCode: guestCountryCode,
            gstn: `GUEST-${randomUUID()}`,
            password: hashSync(randomUUID(), 10),
            status: true,
            roleId: role.id,
          },
        });
      }
      payload = { userId: guestUser.id, name: guestUser.name, email: guestUser.email };
    }
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    if (!requestedItems.length) {
      return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    }
    const requiredAddressFields = ["address", "city", "postalCode", "country"];
    if (!shipping || requiredAddressFields.some((field) => !String(shipping[field] || "").trim())) {
      return NextResponse.json({ error: "A complete shipping address is required." }, { status: 400 });
    }
    const productIds = [...new Set(requestedItems.map((item) => Number(item.productId)))];

    const order = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: productIds }, status: true } });
      const productsById = new Map(products.map((product) => [product.id, product]));
      const items = requestedItems.map((item) => {
        const product = productsById.get(Number(item.productId));
        const quantity = Number(item.quantity);
        if (!product || !Number.isInteger(quantity) || quantity < 1) throw new Error("INVALID_ITEM");
        if (quantity > product.stock) throw new Error(`OUT_OF_STOCK:${product.name}:${product.stock}`);
        return {
          productId: product.id,
          quantity,
          backlogquantity: Number(item.backlogquantity) || 0,
          price: product.price,
        };
      });
      const amount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      const createdOrder = await tx.order.create({
        data: {
          userId: Number(payload.userId),
          jsonData,
          items: { create: items },
          shipping: shipping ? { create: shipping } : undefined,
          payment: payment ? {
            create: {
              ...payment,
              userId: Number(payment.userId || payload.userId),
              amount,
            },
          } : undefined,
        },
        include: {
          user: { select: safeUserSelect },
          items: { include: { product: true } },
          shipping: true,
          payment: true,
        },
      });

      for (const item of items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count !== 1) {
          throw new Error(`OUT_OF_STOCK:${productsById.get(item.productId)?.name || "Product"}:0`);
        }
      }
      return createdOrder;
    });

    const itemsText = order.items
      .map((item) => {
        const lineTotal = item.price * item.quantity;
        return `${item.product.name} × ${item.quantity} = ₹${lineTotal.toFixed(2)}`;
      })
      .join('\n');

    const orderhtml = generateOrderSummaryHTML(order, payload.name);
    await sendEmail(payload.email, "Order Created with " + order.id, orderhtml);
    await sendWhatsAppOrderCreate(order?.user?.name, order?.user?.countryCode + order?.user?.phone, order.id, "Status : Created", itemsText);
    await createNotification("Order Created with " + order.id, payload.userId.toString(), orderhtml);
    if (idempotencyKey) {
      recentRequests.set(idempotencyKey, order);
      setTimeout(() => recentRequests.delete(idempotencyKey), 5 * 60 * 1000);
    }
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error?.message?.startsWith("OUT_OF_STOCK:")) {
      const [, name, stock] = error.message.split(":");
      return NextResponse.json({ error: `${name} only has ${stock} item(s) available.` }, { status: 409 });
    }
    if (error?.message === "INVALID_ITEM") {
      return NextResponse.json({ error: "One or more cart items are invalid." }, { status: 400 });
    }
    console.error("POST /orders error:", error);
    return NextResponse.json({ error: "Unable to place the order. Please try again." }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, status, approved = false } = body;
    if (!Number.isInteger(Number(id)) || Number(id) < 1) {
      return NextResponse.json({ error: "A valid order ID is required" }, { status: 400 });
    }
    if (await verifyAdmin(request)) {
      if (approved) {
        let filterProduct, offer, jsonData = [], jsonFound = false;
        let orders = await prisma.order.findUnique({
          where: {
            id: id,
          },
          include: {
            user: true,
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
 //       await generateTaxDiscount(orders);
        const Products = await prisma.product.findMany();
        let _jsonData = [];
        for (const el of orders.items) {
          const offer = await prisma.offers.findMany({
            where: {
              userId: { contains: orders?.user?.id?.toString() },
              categoryId: { contains: el.product?.categoryId?.toString() }
            }
          });

          const filterProduct = Products.filter(
            (p) => Number(el.product?.id) === p.id
          );

          if (filterProduct.length === 0) continue;
          let product = filterProduct[0];
          let price = Number(product.price);
          let discount = Number(offer[0]?.discount || 0);

          // always start with an array
          let jsonData = Array.isArray(product.jsonData)
            ? [...product.jsonData]
            : [];

          // try to find existing entry
          let found = false;

          jsonData = jsonData.map((entry) => {
            if (
              entry.orderId === orders.id &&
              entry.userId === orders.user?.id &&
              entry.categoryId === el.product?.categoryId
            ) {
              found = true;
              const discountAmount = (price * discount) / 100;
              return {
                ...entry,
                discountPercentage: discount,
                discountAmount,
                sellingPrice: price - discountAmount
              };
            }
            return entry;
          });

          // if not found, add a new one
          if (!found) {
            const discountAmount = (price * discount) / 100;
            jsonData.push({
              orderId: orders.id,
              userId: orders.user?.id,
              categoryId: el.product?.categoryId,
              discountPercentage: discount,
              discountAmount,
              sellingPrice: price - discountAmount
            });
          }
          const _discountAmount = (price * discount) / 100;
          let tax = el.product?.tax ? await prisma.tax.findUnique({
            where: { id: Number(el.product.tax) },
          }) : null;
          const taxPercent = Number(tax?.value || 0);
          let taxamt = taxPercent > 0 ? ((price - _discountAmount) * taxPercent) / 100 : 0;
          
    //     console.log(el.quantity);
    //     console.log(el.price);
          const _itemjsonData = {
            productId : el.product?.id,
            name : el.product?.name,
            quantity : el.quantity,
            price : Number(el.price),
            discountPercentage: discount,
            discountAmount: _discountAmount,
            sellingPrice: price - _discountAmount,
            taxPercentage: taxPercent,
            taxAmount: taxamt,
            totalPrice: ((price - _discountAmount) + taxamt) * Number(el.quantity)
          };
          _jsonData.push(_itemjsonData);
          await prisma.product.update({
            where: { id: product.id },
            data: { jsonData }
          });
        }

        let result = await prisma.order.update({
           where: { id },
           data: 
          { 
            status, 
            approved,
            jsonOrderData : _jsonData
           }
         });
         
        const notification = await prisma.notification.create({
          data: {
            name: 'Order ' + id + ' approved',
            type: "notification",
            remarks: "Order Number " + id + " approved by Admin, Please proceed for payment",
            recepient: orders?.userId.toString()
          }
        });
        //return NextResponse.json(result);
        // return NextResponse.json({ offer, Products, filterProduct });
        const itemsTextapproved = orders.items
          .map((item) => {
            return `${item.product.name} X ${item.quantity}`;
          })
          .join('\n');
          const cdt = await convertDate(orders.createdAt) ; 
          const ddt = await calcDate(orders.createdAt,7) ; 
          console.log(result.jsonOrderData);
          let data = {
              company: { name: "Earthling Consumer Products Pvt. Ltd.", address: "52/39, LGF, Ramjas Road, Karol Bagh, New Delhi 1100053", email : "contact@earthlingco.in" },
              customer: { 
                name: orders.user.name, 
                phone: orders.user.phone, 
                address: orders.shipping.address 
              },
              orderDate : cdt,
              dueDate : ddt,
              items: result.jsonOrderData,
              bankDetails: {
                bankName: "HDFC Bank",
                accountNo: "987654321",
                ifc: "GLB001"
              }
            };
        const orderhtml = generateApprovedOrderSummaryHTML(orders, Number(orders.userId), orders?.user?.name);
        void Promise.allSettled([
          generateInvoicePdf(orders.id, data),
          sendEmail(orders?.user?.email, "Order Approved with " + result.id, orderhtml),
          createNotification("Order Approved with " + orders.id, orders?.userId?.toString(), orderhtml),
          sendWhatsAppOrderCreate(orders?.user?.name, orders?.user?.countryCode + orders?.user?.phone, orders.id, "Status : Approved", itemsTextapproved),
        ]).then((sideEffects) => {
          sideEffects.forEach((effect) => effect.status === "rejected" && console.error("Order approval side effect failed", effect.reason));
        });

        return NextResponse.json({ message: "Order approved", order: result });
      } else if (status == "REJECTED") {
        const order = await prisma.order.findUnique({ where: { id: id } });
        if (!order) {
          return NextResponse.json({ msg: "Order details not found!" }, { status: 404 });
        }
        let update = await prisma.order.update({ where: { id: id }, data:{ status : status} });
        return NextResponse.json({msg: "Rejected"}, { status: 200 });
      } else {
       return NextResponse.json({ error: "Unsupported order status update" }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  } catch (Error) {
    console.log(Error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}
