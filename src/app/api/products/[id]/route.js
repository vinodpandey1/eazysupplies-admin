import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../../utils/jwt";
import {
  applyCustomerPrice,
  loadCustomerOfferContext,
  pricingHeaders,
} from "../../utils/offerPricing";

const prisma = new PrismaClient();
export async function GET(request, { params }) {
  try {
    const id = (await params).id;
    const payload = await authenticate(request);
    const offerContext = await loadCustomerOfferContext(prisma, payload?.userId);
    const product = await prisma.product.findUnique({
      where: { id: Number(id) },
      include: { category: true, brand: true },
    });
    return NextResponse.json(applyCustomerPrice(product, offerContext), {
      headers: pricingHeaders(offerContext),
    });
  } catch (error) {
    console.error("GET /products/[id] error:", error);
    return NextResponse.json(
      { error: "Unable to load product." },
      { status: 500, headers: pricingHeaders() },
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const payload = await authenticate(request);
    if (!payload?.userId) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }
    if (!(await verifyAdmin(request))) {
      return NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      );
    }

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json(
        { error: "A valid product ID is required." },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, _count: { select: { orderItems: true } } },
    });
    if (!product) {
      return NextResponse.json(
        { error: "Product not found." },
        { status: 404 }
      );
    }
    if (product._count.orderItems > 0) {
      return NextResponse.json(
        { error: "This product is used by an order and cannot be deleted. Mark it inactive instead." },
        { status: 409 }
      );
    }

    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
    return NextResponse.json({ message: "Product deleted successfully." });
  } catch (error) {
    const isReferenced = error?.code === "P2003";
    console.error("DELETE /products/[id] error:", error);
    return NextResponse.json(
      { error: isReferenced ? "This product is in use and cannot be deleted." : "Unable to delete product." },
      { status: isReferenced ? 409 : 500 }
    );
  }
}
