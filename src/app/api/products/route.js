import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../utils/jwt";
import { MESSAGES } from "../utils/statusConstant";
import {
  applyCustomerPrices,
  calculateCustomerPrice,
  loadCustomerOfferContext,
  pricingHeaders,
} from "../utils/offerPricing";
const prisma = new PrismaClient();

// export async function GET() {
//   const res =  await prisma.product.findMany({
//     include: { category: true, brand: true }  // tags: { include: { tag: true } }tags: { include: { tag: true } }
//   })
//   return NextResponse.json(res);
// }

export async function GET(request) {
  try {
    const payload = await authenticate(request);
    const offerContext = await loadCustomerOfferContext(prisma, payload?.userId);
    const responseHeaders = pricingHeaders(offerContext);
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("productId"));
    if (id) {
      const product = await prisma.product.findUnique({
        where: { id },
        include: { category: true, brand: true },
      });
      const [pricedProduct] = applyCustomerPrices(
        product ? [product] : [],
        offerContext,
      );
      return NextResponse.json(
        { data: pricedProduct || [] },
        { status: 200, headers: responseHeaders },
      );
    }

    const parseIds = (value) => value?.split(",").map(Number).filter(Number.isInteger);
    const ids = parseIds(searchParams.get("ids"));
    const categoryIds = parseIds(searchParams.get("category_ids")) ||
      (Number(searchParams.get("categoryId")) ? [Number(searchParams.get("categoryId"))] : undefined);
    const brandIds = parseIds(searchParams.get("brand_ids")) ||
      (Number(searchParams.get("brandId")) ? [Number(searchParams.get("brandId"))] : undefined);
    const search = searchParams.get("search")?.trim();
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const perPage = Math.min(Math.max(Number(searchParams.get("paginate")) || 25, 1), 100);
    const storefrontKeys = ["status", "paginate", "ids", "search", "category_ids", "brand_ids", "field", "sort"];
    const isStorefrontRequest = storefrontKeys.some((key) => searchParams.has(key));
    const allowedSortFields = new Set(["name", "price", "stock", "createdAt", "updatedAt"]);
    const requestedField = searchParams.get("field");
    const sortField = allowedSortFields.has(requestedField) ? requestedField : "createdAt";
    const sortDirection = searchParams.get("sort") === "desc" ? "desc" : "asc";

    const where = {
      ...(searchParams.get("status") === "1" || ids?.length ? { status: true } : {}),
      ...(ids?.length ? { id: { in: ids } } : {}),
      ...(categoryIds?.length ? { categoryId: { in: categoryIds } } : {}),
      ...(brandIds?.length ? { brandId: { in: brandIds } } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
          { sku: { contains: search } },
          { keyword: { contains: search } },
          { category: { name: { contains: search } } },
          { brand: { name: { contains: search } } },
        ],
      } : {}),
    };

    let products;
    let total;

    if (isStorefrontRequest) {
      // Product imports can contain multiple database rows for the same SKU.
      // Build the storefront page from the globally de-duplicated, sorted ID
      // list so a duplicate cannot reappear on a later page and pagination
      // totals describe what shoppers can actually see.
      const productKeys = await prisma.product.findMany({
        where,
        select: { id: true, sku: true, price: true, categoryId: true },
        orderBy: { [sortField]: sortDirection },
      });
      const seenProductKeys = new Set();
      let uniqueProductKeys = productKeys.reduce((unique, product) => {
        const normalizedSku = product.sku?.trim()?.toLowerCase();
        const key = normalizedSku || `id:${product.id}`;
        if (!seenProductKeys.has(key)) {
          seenProductKeys.add(key);
          unique.push(product);
        }
        return unique;
      }, []);
      // Customer offers may differ by category, so a price sort has to use the
      // server-computed effective price rather than the base catalogue price.
      if (offerContext.userId && sortField === "price") {
        const direction = sortDirection === "desc" ? -1 : 1;
        uniqueProductKeys = uniqueProductKeys.sort((a, b) => {
          const aPrice = calculateCustomerPrice(a, offerContext).effectivePrice;
          const bPrice = calculateCustomerPrice(b, offerContext).effectivePrice;
          return (aPrice - bPrice || a.id - b.id) * direction;
        });
      }
      const uniqueProductIds = uniqueProductKeys.map((product) => product.id);
      const pageIds = uniqueProductIds.slice((page - 1) * perPage, page * perPage);
      const pageProducts = pageIds.length
        ? await prisma.product.findMany({
            where: { id: { in: pageIds } },
            include: { category: true, brand: true },
          })
        : [];
      const productById = new Map(pageProducts.map((product) => [product.id, product]));
      products = pageIds.map((id) => productById.get(id)).filter(Boolean);
      total = uniqueProductIds.length;
    } else {
      products = await prisma.product.findMany({
        where,
        include: { category: true, brand: true },
        orderBy: { [sortField]: sortDirection },
      });
      total = products.length;
    }
    products = applyCustomerPrices(products, offerContext);
    const tax = await prisma.tax.findMany();

    const allSupplierIds = products
      .map((p) => p.supplier)            // get comma-separated string
      .filter(Boolean)                   // remove null or empty
      .flatMap((supStr) => supStr.split(',')) // split string to array
      .map((id) => Number(id))           // convert to number (adjust if string)
      .filter((id) => !isNaN(id));       // filter invalid

    // Remove duplicates
    const uniqueSupplierIds = [...new Set(allSupplierIds)];

    // 3. Fetch suppliers
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: uniqueSupplierIds } },
    });

    // 4. Create a lookup map for suppliers by ID
    const supplierMap = suppliers.reduce((acc, supplier) => {
      acc[supplier.id] = supplier;
      return acc;
    }, {});

    // 5. Attach suppliers details to each product
    const productsWithSuppliers = products.map((product) => {
      const supplierIds = product.supplier
        ? product.supplier.split(',').map((id) => Number(id))
        : [];

      return {
        ...product,
        suppliers: supplierIds.map((id) => supplierMap[id]).filter(Boolean),
      };
    });

    if (!isStorefrontRequest) {
      return NextResponse.json(
        { data: productsWithSuppliers, tax },
        { status: 200, headers: responseHeaders },
      );
    }

    return NextResponse.json({
      current_page: page,
      last_page: Math.ceil(total / perPage),
      total,
      per_page: perPage,
      data: productsWithSuppliers,
    }, { headers: responseHeaders });
  } catch (err) {
    console.error("GET /products error:", err);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500, headers: pricingHeaders() },
    );
  }
}

export async function POST(request) {
  try {
    let payload = await authenticate(request);
    if (await verifyAdmin(request)) {
      const body = await request.json();
      body.createdBy = Number(payload?.userId);
      const res = await prisma.product.create({ data: body });
      return NextResponse.json({ data: res }, { status: 201 });
    }
  } catch (Error) {
    console.log('..........Error', Error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}


export async function PUT(request) {
  try {
    if (await verifyAdmin(request)) {
      const body = await request.json();
      const { id, ...rest } = body;
      let prod = await prisma.product.update({ where: { id }, data: rest });
      return NextResponse.json(prod);
    }
  } catch (Error) {
    console.log(Error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}
