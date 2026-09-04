import { NextResponse } from 'next/server';
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin, handleHtmlFromOrder } from "../../utils/jwt";

const prisma = new PrismaClient();

export async function GET(request , { params }) {
  
    try {
     const id = (await params).id;
     const payload = await authenticate(request);
     if (!payload?.userId) {
       return NextResponse.json({ error: "Authentication required" }, { status: 401 });
     }
     const order = await prisma.order.findUnique({
       where: { id: Number(id) },
       select: { userId: true, approved: true, invoicepath: true },
     });
     if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
     if (order.userId !== Number(payload.userId) && !(await verifyAdmin(request))) {
       return NextResponse.json({ error: "Invoice access denied" }, { status: 403 });
     }
     if (!order.approved || !order.invoicepath) {
       return NextResponse.json(
         { error: "Invoice will be available after the order is approved" },
         { status: 409, headers: { "Cache-Control": "private, no-store" } }
       );
     }

    const { html } = await handleHtmlFromOrder(Number(id));
    return new NextResponse(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'private, no-store',
          },
      })

  } catch (error) {
    console.error("Invoice API Error:", error);
    return NextResponse.json({ error: "Failed to render invoice" }, { status: 500 });
  }
}
