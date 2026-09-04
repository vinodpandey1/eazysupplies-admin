import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer";
import { verifyAdmin, handleHtmlFromOrder } from "../../utils/jwt";

const prisma = new PrismaClient();

async function generateOrderPdf(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId) },
    select: { id: true, userId: true, approved: true },
  });
  if (!order) return null;
  if (!order.approved) return { pendingApproval: true };

  const { html } = await handleHtmlFromOrder(Number(orderId));
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let pdfBuffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      landscape: true,
      preferCSSPageSize: true,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    });
  } finally {
    await browser.close();
  }

  const folderPath = path.join(process.env.FILE_PATH || path.join(process.cwd(), "public"), "invoice");
  fs.mkdirSync(folderPath, { recursive: true });
  const filename = `performa-invoice${Number(orderId)}.pdf`;
  const filePath = path.join(folderPath, filename);
  fs.writeFileSync(filePath, pdfBuffer);

  await prisma.assets.upsert({
    where: { id: (await prisma.assets.findFirst({ where: { name: filename }, select: { id: true } }))?.id || 0 },
    update: { path: `/invoice/${filename}`, author: String(order.userId), type: "invoice" },
    create: {
      name: filename,
      type: "invoice",
      path: `/invoice/${filename}`,
      author: String(order.userId),
      tag: filename,
    },
  });
  await prisma.order.update({ where: { id: Number(orderId) }, data: { invoicepath: filePath } });
  return { filePath, filename };
}

async function handleRequest(request, orderId) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!Number.isInteger(Number(orderId)) || Number(orderId) < 1) {
    return NextResponse.json({ error: "A valid order ID is required" }, { status: 400 });
  }
  const result = await generateOrderPdf(Number(orderId));
  if (!result) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (result.pendingApproval) {
    return NextResponse.json(
      { error: "Invoice can only be generated after the order is approved" },
      { status: 409 }
    );
  }
  return NextResponse.json({ message: "PDF generated successfully", path: result.filePath });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return await handleRequest(request, Number(searchParams.get("orderId")));
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return await handleRequest(request, Number(body.orderId));
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
