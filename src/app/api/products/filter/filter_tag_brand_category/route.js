import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { MESSAGES } from "@/app/api/utils/statusConstant";
import { pricingHeaders } from "@/app/api/utils/offerPricing";
const prisma = new PrismaClient();


export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        if (searchParams.get("tag_brand_category")) {
            const tag = await prisma.tag.findMany();
            const brand = await prisma.brand.findMany();
            const category = await prisma.category.findMany();
            const tax = await prisma.tax.findMany();
            const supplier = await prisma.supplier.findMany();
            return NextResponse.json({ tags: tag, brands: brand, categories: category, tax: tax, supplier: supplier}, { status: 200, headers: pricingHeaders() });
        } else {
            return NextResponse.json({ error: "filter is not allowed!" }, { headers: pricingHeaders() });
        }

    } catch (Error) {
        console.log("Error", Error);
        return NextResponse.json({ Error: "Internal server error" }, { status: 500, headers: pricingHeaders() });
    }

}
