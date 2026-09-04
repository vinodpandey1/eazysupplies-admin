import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyAdmin, authenticate } from "../utils/jwt";
import { MESSAGES } from "../utils/statusConstant";
import { generateOrderSummaryHTML, generateApprovedOrderSummaryHTML, sendEmail, sendWhatsAppOrderCreate } from "../utils/emailUtils";
import { createNotification } from "../utils/emailUtils";
import { generateInvoicePdf } from "../utils/pdfUtils";
import { convertDate, calcDate } from "../utils/dateUtils";
import { hashSync } from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import {
  calculateCustomerPrice,
  findApplicableOffer,
  loadCustomerOfferContext,
} from "../utils/offerPricing";

const prisma = new PrismaClient();
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
};
const QUOTE_KEY = "_pricingQuote";
const ALLOWED_INITIAL_PAYMENT_METHODS = new Set([
  "CREDIT_CARD",
  "NB",
  "OFF",
  "ONLINE",
  "OFFLINE",
]);
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const clientJsonObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { clientData: value ?? null };
const quoteFromOrder = (order) => {
  const quote = order?.jsonData?.[QUOTE_KEY];
  return quote?.state === "QUOTED" && Array.isArray(quote.items) ? quote : null;
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
const orderInclude = {
  user: { select: safeUserSelect },
  items: { include: { product: true } },
  shipping: true,
  payment: true,
};
const hashRequest = (body) => createHash("sha256")
  .update(JSON.stringify(body || {}))
  .digest("hex");
const normalizedIdempotencyKey = (value) => {
  const key = String(value || "").trim();
  return key && key.length <= 191 ? key : null;
};
const findReplayOrder = async (record) => {
  if (!record?.orderId) return null;
  return prisma.order.findUnique({
    where: { id: Number(record.orderId) },
    include: orderInclude,
  });
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

    return NextResponse.json(
      {
        page,
        current_page: page,
        limit,
        per_page: limit,
        total,
        totalPages: Math.ceil(total / limit),
        last_page: Math.ceil(total / limit),
        orders,
        data: orders,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("GET /orders error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

// 📌 POST /api/orders
export async function POST(request) {
  try {
    const tokenPayload = await authenticate(request);
    let authenticatedPayload = null;
    if (tokenPayload?.userId) {
      const activeUser = await prisma.user.findFirst({
        where: {
          id: Number(tokenPayload.userId),
          status: true,
          deleted: false,
        },
        select: safeUserSelect,
      });
      if (!activeUser) {
        return NextResponse.json(
          { error: "Your account is inactive or no longer available. Please sign in again." },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }
      authenticatedPayload = {
        ...tokenPayload,
        userId: activeUser.id,
        name: activeUser.name,
        email: activeUser.email,
      };
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
        const role = await prisma.role.upsert({
          where: { name: "customer" },
          update: {},
          create: { name: "customer" },
        });
        try {
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
        } catch (guestCreateError) {
          if (guestCreateError?.code !== "P2002") throw guestCreateError;

          // A simultaneous first checkout can create the same guest while this
          // request is waiting on the unique email/phone indexes. Resolve the
          // committed user and continue instead of returning an opaque 500.
          const [racedEmailUser, racedPhoneUser] = await Promise.all([
            prisma.user.findUnique({ where: { email: guestEmail } }),
            prisma.user.findUnique({ where: { phone: guestPhone } }),
          ]);
          if (
            racedEmailUser &&
            racedPhoneUser &&
            racedEmailUser.id !== racedPhoneUser.id
          ) {
            return NextResponse.json(
              { error: "The email and phone number belong to different accounts. Please log in or use different details." },
              { status: 409, headers: NO_STORE_HEADERS }
            );
          }
          guestUser = racedEmailUser || racedPhoneUser;
          if (!guestUser) throw guestCreateError;
        }
      }
      payload = { userId: guestUser.id, name: guestUser.name, email: guestUser.email };
    }

    const requestHash = hashRequest(body);
    const suppliedKey = normalizedIdempotencyKey(
      request.headers.get("idempotency-key")
    );
    // Legacy/mobile callers may not yet send the header. A short time-bucketed
    // deterministic key still protects the common double-tap/retry path while
    // preserving the ability to intentionally repeat an identical order later.
    const automaticKey = `auto:${payload.userId}:${Math.floor(Date.now() / 120000)}:${requestHash}`;
    const idempotencyKey = suppliedKey || automaticKey;
    const existingRequest = await prisma.orderIdempotency.findUnique({
      where: { key: idempotencyKey },
    });
    if (existingRequest) {
      if (
        existingRequest.requestHash !== requestHash ||
        Number(existingRequest.userId) !== Number(payload.userId)
      ) {
        return NextResponse.json(
          { error: "This checkout request key was already used for different order details." },
          { status: 409, headers: NO_STORE_HEADERS }
        );
      }
      const replayOrder = await findReplayOrder(existingRequest);
      if (replayOrder) {
        return NextResponse.json(replayOrder, {
          status: 200,
          headers: { ...NO_STORE_HEADERS, "Idempotent-Replayed": "true" },
        });
      }
      return NextResponse.json(
        { error: "This order request is already being processed. Please wait before retrying." },
        { status: 409, headers: { ...NO_STORE_HEADERS, "Retry-After": "2" } }
      );
    }
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    if (!requestedItems.length) {
      return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    }
    const rawProductIds = requestedItems.map((item) => Number(item.productId));
    if (rawProductIds.some((id) => !Number.isInteger(id) || id < 1)) {
      return NextResponse.json(
        { error: "One or more cart products are invalid." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (new Set(rawProductIds).size !== rawProductIds.length) {
      return NextResponse.json(
        { error: "Duplicate products were found in the cart. Please refresh the cart and try again." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const requiredAddressFields = ["address", "city", "postalCode", "country"];
    if (!shipping || requiredAddressFields.some((field) => !String(shipping[field] || "").trim())) {
      return NextResponse.json({ error: "A complete shipping address is required." }, { status: 400 });
    }
    const productIds = rawProductIds;
    const paymentMethod = payment ? String(payment.method || "").trim().toUpperCase() : null;
    if (payment && !ALLOWED_INITIAL_PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json(
        { error: "A supported payment method is required." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
      await tx.orderIdempotency.create({
        data: {
          key: idempotencyKey,
          requestHash,
          userId: Number(payload.userId),
          status: "PROCESSING",
        },
      });
      const products = await tx.product.findMany({ where: { id: { in: productIds }, status: true } });
      const productsById = new Map(products.map((product) => [product.id, product]));
      // Customer offers are an authenticated benefit. Guest checkout can
      // resolve an existing account by email/phone, but that must not be enough
      // to claim the account's private pricing.
      const offerContext = await loadCustomerOfferContext(
        tx,
        authenticatedPayload?.userId,
      );
      const pricedItems = requestedItems.map((item) => {
        const product = productsById.get(Number(item.productId));
        const quantity = Number(item.quantity);
        if (!product || !Number.isInteger(quantity) || quantity < 1) throw new Error("INVALID_ITEM");
        if (quantity > product.stock) throw new Error(`OUT_OF_STOCK:${product.name}:${product.stock}`);
        const customerPrice = calculateCustomerPrice(product, offerContext);
        const displayedUnitPrice = Number(item.price);
        if (
          Number.isFinite(displayedUnitPrice) &&
          Math.abs(displayedUnitPrice - customerPrice.effectivePrice) > 0.009
        ) {
          const pricingError = new Error("PRICE_CHANGED");
          pricingError.productName = product.name;
          pricingError.currentPrice = customerPrice.effectivePrice;
          throw pricingError;
        }
        return {
          productId: product.id,
          quantity,
          backlogquantity: Number(item.backlogquantity) || 0,
          price: product.price,
          pricingSnapshot: {
            productId: product.id,
            name: product.name || "Product",
            quantity,
            price: customerPrice.regularPrice,
            discountPercentage: customerPrice.discountPercentage,
            discountAmount: customerPrice.discountAmount,
            sellingPrice: customerPrice.effectivePrice,
            taxPercentage: 0,
            taxAmount: 0,
            totalPrice: roundMoney(customerPrice.effectivePrice * quantity),
            offerId: customerPrice.offer?.id || null,
            offerName: customerPrice.offer?.name || null,
          },
        };
      });
      const orderSnapshots = pricedItems.map((item) => item.pricingSnapshot);
      const items = pricedItems.map(({ pricingSnapshot, ...item }) => item);
      const amount = roundMoney(
        orderSnapshots.reduce(
          (sum, item) => sum + Number(item.totalPrice || 0),
          0,
        ),
      );

      const createdOrder = await tx.order.create({
        data: {
          userId: Number(payload.userId),
          // Keep a non-payable quote separate from jsonOrderData. The BenePay
          // flow treats jsonOrderData as the approved amount, so it must remain
          // empty until an administrator approves and freezes the order.
          jsonData: {
            ...clientJsonObject(jsonData),
            [QUOTE_KEY]: {
              version: 1,
              state: "QUOTED",
              calculatedAt: new Date().toISOString(),
              subtotal: amount,
              items: orderSnapshots,
            },
          },
          items: { create: items },
          shipping: shipping ? { create: shipping } : undefined,
          payment: payment ? {
            create: {
              userId: Number(payload.userId),
              amount,
              method: paymentMethod,
              status: "PENDING",
              transectionid: null,
              file: null,
            },
          } : undefined,
        },
        include: orderInclude,
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
      await tx.orderIdempotency.update({
        where: { key: idempotencyKey },
        data: { orderId: createdOrder.id, status: "COMPLETED" },
      });
      return createdOrder;
      });
    } catch (transactionError) {
      // A concurrent request can win the unique-key reservation while this
      // transaction is waiting. Replay its committed order instead of creating
      // another one or returning an opaque error.
      if (transactionError?.code === "P2002") {
        const racedRequest = await prisma.orderIdempotency.findUnique({
          where: { key: idempotencyKey },
        });
        if (
          racedRequest?.requestHash === requestHash &&
          Number(racedRequest?.userId) === Number(payload.userId)
        ) {
          const replayOrder = await findReplayOrder(racedRequest);
          if (replayOrder) {
            return NextResponse.json(replayOrder, {
              status: 200,
              headers: { ...NO_STORE_HEADERS, "Idempotent-Replayed": "true" },
            });
          }
        }
      }
      throw transactionError;
    }

    const quote = quoteFromOrder(order);
    const priceByProduct = new Map(
      (quote?.items || []).map((item) => [Number(item.productId), item]),
    );
    const notificationOrder = {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        price: Number(priceByProduct.get(Number(item.productId))?.sellingPrice ?? item.price),
      })),
    };
    const itemsText = notificationOrder.items
      .map((item) => {
        const lineTotal = Number(item.price) * item.quantity;
        return `${item.product.name} × ${item.quantity} = ₹${lineTotal.toFixed(2)}`;
      })
      .join('\n');

    const orderhtml = generateOrderSummaryHTML(notificationOrder, payload.name);
    const deliveryResults = await Promise.allSettled([
      sendEmail(payload.email, "Order Created with " + order.id, orderhtml),
      sendWhatsAppOrderCreate(order?.user?.name, order?.user?.countryCode + order?.user?.phone, order.id, "Status : Created", itemsText),
      createNotification("Order Created with " + order.id, payload.userId.toString(), orderhtml),
    ]);
    deliveryResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Order ${order.id} post-order delivery ${index + 1} failed:`, result.reason);
      }
    });
    return NextResponse.json(order, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error?.message?.startsWith("OUT_OF_STOCK:")) {
      const [, name, stock] = error.message.split(":");
      return NextResponse.json({ error: `${name} only has ${stock} item(s) available.` }, { status: 409 });
    }
    if (error?.message === "INVALID_ITEM") {
      return NextResponse.json({ error: "One or more cart items are invalid." }, { status: 400 });
    }
    if (error?.message === "PRICE_CHANGED") {
      return NextResponse.json(
        {
          error: `${error.productName || "A product"} has a new price of ₹${roundMoney(error.currentPrice || 0).toFixed(2)}. Please refresh your cart and review the updated total.`,
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    console.error("POST /orders error:", error);
    return NextResponse.json({ error: "Unable to place the order. Please try again." }, { status: 500 });
  }
}

export async function PUT(request) {
  let approvalClaim = null;
  try {
    const body = await request.json();
    const { id, status, approved = false } = body;
    if (!Number.isInteger(Number(id)) || Number(id) < 1) {
      return NextResponse.json({ error: "A valid order ID is required" }, { status: 400 });
    }
    if (await verifyAdmin(request)) {
      if (approved) {
        const orders = await prisma.order.findUnique({
          where: {
            id: Number(id),
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
        if (orders.approved) {
          return NextResponse.json(
            { message: "Order is already approved", order: orders },
            { status: 200, headers: NO_STORE_HEADERS },
          );
        }
        if (orders.status === "REJECTED") {
          return NextResponse.json(
            { error: "A rejected order cannot be approved." },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }

        // Claim approval before PDF generation. This makes repeated or
        // concurrent clicks one-way/idempotent without exposing an approved
        // order until its immutable snapshot and invoice are ready.
        const claimed = await prisma.order.updateMany({
          where: {
            id: Number(id),
            approved: false,
            status: { notIn: ["REJECTED", "APPROVING"] },
          },
          data: { status: "APPROVING" },
        });
        if (claimed.count !== 1) {
          const current = await prisma.order.findUnique({
            where: { id: Number(id) },
            include: orderInclude,
          });
          if (current?.approved) {
            return NextResponse.json(
              { message: "Order is already approved", order: current },
              { status: 200, headers: NO_STORE_HEADERS },
            );
          }
          return NextResponse.json(
            { error: current?.status === "APPROVING" ? "Order approval is already in progress." : "Order cannot be approved." },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }
        approvalClaim = { id: Number(id), previousStatus: orders.status };

        const [offers, taxes] = await Promise.all([
          prisma.offers.findMany({
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          }),
          prisma.tax.findMany(),
        ]);
        const taxById = new Map(taxes.map((tax) => [Number(tax.id), Number(tax.value || 0)]));
        const checkoutQuote = quoteFromOrder(orders);
        const orderSnapshots = orders.items.map((item) => {
          const checkoutSnapshot = checkoutQuote
            ? checkoutQuote.items.find(
                (snapshot) => Number(snapshot?.productId) === Number(item.productId),
              )
            : null;
          const applicableOffer = findApplicableOffer(
            offers,
            orders.userId,
            item.product?.categoryId,
          );
          const unitPrice = Math.max(Number(item.price || 0), 0);
          const quantity = Math.max(Number(item.quantity || 0), 0);
          const discountPercentage = Math.min(
            Math.max(
              Number(
                checkoutSnapshot?.discountPercentage ??
                  applicableOffer?.discount ??
                  0,
              ),
              0,
            ),
            100,
          );
          const discountAmount = roundMoney(unitPrice * discountPercentage / 100);
          const sellingPrice = roundMoney(unitPrice - discountAmount);
          const taxPercentage = Number(taxById.get(Number(item.product?.tax)) || 0);
          const taxAmount = roundMoney(sellingPrice * taxPercentage / 100);

          return {
            productId: item.productId,
            name: item.product?.name || "Product",
            quantity,
            price: unitPrice,
            discountPercentage,
            discountAmount,
            sellingPrice,
            taxPercentage,
            taxAmount,
            totalPrice: roundMoney((sellingPrice + taxAmount) * quantity),
            offerId: checkoutSnapshot
              ? checkoutSnapshot.offerId ?? null
              : applicableOffer?.id ?? null,
            offerName: checkoutSnapshot
              ? checkoutSnapshot.offerName ?? null
              : applicableOffer?.name ?? null,
          };
        });
        const snapshotGrandTotal = roundMoney(
          orderSnapshots.reduce(
            (total, item) => total + Number(item.totalPrice || 0),
            0
          )
        );

        const itemsTextapproved = orders.items
          .map((item) => `${item.product.name} X ${item.quantity}`)
          .join('\n');
        const cdt = await convertDate(orders.createdAt);
        const ddt = await calcDate(orders.createdAt, 7);
        const invoiceData = {
          company: {
            name: "Earthling Consumer Products Pvt. Ltd.",
            address: "52/39, LGF, Ramjas Road, Karol Bagh, New Delhi 1100053",
            email: "contact@earthlingco.in",
          },
          customer: {
            name: orders.user.name,
            phone: orders.user.phone,
            address: orders.shipping?.address || "",
          },
          orderDate: cdt,
          dueDate: ddt,
          items: orderSnapshots,
          bankDetails: {
            bankName: "HDFC Bank",
            accountNo: "987654321",
            ifc: "GLB001",
          },
        };

        // Build and persist the invoice before exposing the approved state.
        // If PDF generation fails, the order remains pending and no broken
        // invoice link can become visible to either the customer or admin.
        await generateInvoicePdf(orders.id, invoiceData);

        const approvedJsonData = checkoutQuote
          ? {
              ...clientJsonObject(orders.jsonData),
              [QUOTE_KEY]: {
                ...checkoutQuote,
                state: "APPROVED",
                approvedAt: new Date().toISOString(),
              },
            }
          : orders.jsonData;
        const [result] = await prisma.$transaction([
          prisma.order.update({
            where: { id: Number(id) },
            data: {
              status: "APPROVED",
              approved: true,
              jsonOrderData: orderSnapshots,
              jsonData: approvedJsonData,
            },
          }),
          prisma.notification.create({
            data: {
              name: 'Order ' + id + ' approved',
              type: "notification",
              remarks: "Order Number " + id + " approved by Admin, Please proceed for payment",
              recepient: orders.userId.toString(),
            },
          }),
          // Payment rows are created with the pre-approval subtotal. Keep the
          // persisted amount aligned with the immutable approved snapshot so
          // admin, storefront and the gateway all display/validate one total.
          prisma.payment.updateMany({
            where: { orderId: Number(id) },
            data: { amount: snapshotGrandTotal },
          }),
        ]);
        approvalClaim = null;
        const orderhtml = generateApprovedOrderSummaryHTML(orders, Number(orders.userId), orders?.user?.name);
        void Promise.allSettled([
          sendEmail(orders?.user?.email, "Order Approved with " + result.id, orderhtml),
          sendWhatsAppOrderCreate(orders?.user?.name, orders?.user?.countryCode + orders?.user?.phone, orders.id, "Status : Approved", itemsTextapproved),
        ]).then((sideEffects) => {
          sideEffects.forEach((effect) => effect.status === "rejected" && console.error("Order approval side effect failed", effect.reason));
        });

        return NextResponse.json({ message: "Order approved", order: result });
      } else if (status == "REJECTED") {
        const order = await prisma.order.findUnique({ where: { id: Number(id) } });
        if (!order) {
          return NextResponse.json({ msg: "Order details not found!" }, { status: 404 });
        }
        if (order.approved) {
          return NextResponse.json(
            { error: "An approved order cannot be rejected." },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }
        if (order.status === "REJECTED") {
          return NextResponse.json(
            { msg: "Rejected" },
            { status: 200, headers: NO_STORE_HEADERS },
          );
        }
        if (order.status === "APPROVING") {
          return NextResponse.json(
            { error: "Order approval is currently in progress." },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }
        await prisma.order.update({ where: { id: Number(id) }, data:{ status : status} });
        return NextResponse.json({msg: "Rejected"}, { status: 200 });
      } else {
       return NextResponse.json({ error: "Unsupported order status update" }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  } catch (error) {
    if (approvalClaim) {
      await prisma.order.updateMany({
        where: {
          id: approvalClaim.id,
          approved: false,
          status: "APPROVING",
        },
        data: {
          status: approvalClaim.previousStatus,
          invoicepath: null,
        },
      }).catch((rollbackError) => {
        console.error("Unable to release failed approval claim:", rollbackError);
      });
    }
    console.log(error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
