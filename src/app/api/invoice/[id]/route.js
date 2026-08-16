import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../../utils/jwt";
import { generateInvoicePdf } from "../../utils/pdfUtils";

const prisma = new PrismaClient();

export async function GET(request, { params }) {
  try {
    const id = Number((await params).id);
    const payload = await authenticate(request);
    if (!payload?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const order = await prisma.order.findUnique({ where: { id }, select: { userId: true, approved: true } });
    const isAdmin = await verifyAdmin(request);
    if (!order || (!isAdmin && Number(order.userId) !== Number(payload.userId))) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (!order.approved) return NextResponse.json({ error: "Invoice is not ready" }, { status: 409 });

    const filePath = await generateInvoicePdf(id);
    const pdf = fs.readFileSync(filePath);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${path.basename(filePath)}"`,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Invoice API Error:", error);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}
