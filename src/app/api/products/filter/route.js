import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../../utils/jwt";
import {
  applyCustomerPrices,
  loadCustomerOfferContext,
  pricingHeaders,
} from "../../utils/offerPricing";

const prisma = new PrismaClient();

export async function GET(request) {
  try {
    const payload = await authenticate(request);
    const offerContext = await loadCustomerOfferContext(prisma, payload?.userId);
    const { searchParams } = new URL(request.url);
    const useSlug = searchParams.get("slug") === "y";
    let items = [];

    // Helper: remove duplicate products by ID
    const removeDuplicatesById = (arr) => {
      const seen = new Set();
      return arr.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };

    // --- TAG FILTER ---
    if (searchParams.get("tag")) {
      const tags = searchParams.get("tag").split(",").map((t) => t.trim());

      items = await Promise.all(
        tags.map(async (tag) => {
          if (useSlug) {
            const tagEntity = await prisma.tag.findFirst({ where: { slug: tag } });
            if (!tagEntity) return [];
            return prisma.product.findMany({
              where: {
               status: true,
                tags: {
                contains: tagEntity.id.toString(), // For case-insensitive search
                },
              },
            });
          } else {
            return prisma.product.findMany({
              where: {
                status: true,
                tags: {
                  contains:  tag ,
                },
              },
            });
          }
        })
      );
      items = items.flat();
    }

    // --- BRAND FILTER ---
    else if (searchParams.get("brand")) {
     const _brand = searchParams.get("brand").split(",").map((c) => c.trim());
       items = await Promise.all(
        _brand.map(async (brnd) => {
          if (useSlug) {
            const brand = await prisma.brand.findFirst({ where: { slug: brnd }, include: { products: { where: { status: true } } } });
            return brand?.products || [];
          } else {
            const brand = await prisma.brand.findUnique({ where: { id: Number(brnd) }, include: { products: { where: { status: true } } } });
            return brand?.products || [];
          }
        })
      );

      items = items.flat();
    }

    // --- CATEGORY FILTER ---
    else if (searchParams.get("category")) {
      const categories = searchParams.get("category").split(",").map((c) => c.trim());

      items = await Promise.all(
        categories.map(async (cat) => {
          if (useSlug) {
            const category = await prisma.category.findFirst({ where: { slug: cat }, include: { products: { where: { status: true } } } });
            return category?.products || [];
          } else {
            const category = await prisma.category.findUnique({ where: { id: Number(cat) }, include: { products: { where: { status: true } } } });
            return category?.products || [];
          }
        })
      );

      items = items.flat();
    }

    // Deduplicate final product list
    const productList = applyCustomerPrices(
      removeDuplicatesById(items),
      offerContext,
    );

    return NextResponse.json(
      { items: productList },
      { headers: pricingHeaders(offerContext) },
    );
  } catch (error) {
    console.error("GET /products error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: pricingHeaders() },
    );
  }
}
