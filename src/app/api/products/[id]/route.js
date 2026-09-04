import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../../utils/jwt";
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
    const id = Number((await params).id);
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ message: "Product deleted" });
  } catch (error) {
    const isReferenced = error?.code === "P2003";
    return NextResponse.json(
      { error: isReferenced ? "This product is used by an order and cannot be deleted." : "Unable to delete product." },
      { status: isReferenced ? 409 : 500 }
    );
  }
}
