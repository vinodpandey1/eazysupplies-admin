import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  authenticate,
  generateTransactionId,
  verifyAdmin,
} from "@/app/api/utils/jwt";
import { MESSAGES } from "@/app/api/utils/statusConstant";
import {
  amountsMatch,
  getApprovedSnapshotTotal,
  NO_STORE_HEADERS,
} from "../paymentValidation";

const prisma = new PrismaClient();
const PAYMENT_METHODS = new Set(["NB", "OFF"]);

class PaymentRequestError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = "PaymentRequestError";
    this.status = status;
  }
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function normalizePhone(user) {
  const phone = String(user?.phone || "").replace(/\D/g, "").slice(-10);
  if (!phone) return "";
  const countryCode = String(user?.countryCode || "+91").replace(/[^\d+]/g, "");
  const normalizedCode = countryCode.startsWith("+")
    ? countryCode
    : `+${countryCode || "91"}`;
  return `${normalizedCode}-${phone}`;
}

function requireGatewayConfig() {
  const config = {
    authUrl: process.env.AuthUrl,
    clientId: process.env.ClientId,
    clientSecret: process.env.ClinetSecretId,
    encryptionUrl: process.env.EncryptionURL,
    encryptionKey: process.env.EncryptionKey,
    apiKey: process.env.X_apiKey,
    requestToPayUrl: process.env.realTimeRequestToPay,
    returnUrl: process.env.ReturnUrl,
  };

  if (Object.values(config).some((value) => !value)) {
    throw new PaymentRequestError(
      "The payment gateway is not configured. Please contact support.",
      503,
    );
  }

  return config;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function validateExistingPayment(payment, order, orderAmount) {
  if (Number(payment.userId) !== Number(order.userId)) {
    throw new PaymentRequestError(
      "The payment record is not associated with the order owner",
    );
  }
  if (!amountsMatch(payment.amount, orderAmount)) {
    throw new PaymentRequestError(
      "The payment record does not match the approved order total",
    );
  }
  if (payment.status === "SUCCESS") {
    throw new PaymentRequestError("This order has already been paid");
  }
  if (!["PENDING", "FAILED"].includes(payment.status)) {
    throw new PaymentRequestError("This payment cannot be processed in its current state");
  }
}

/**
 * Reserve one stable requestor transaction per order. A repeated NB request
 * reuses the same requestorTransactionId instead of creating another live
 * BenePay attempt. The provider is therefore given the same idempotency key on
 * retries even when the browser lost the first response.
 */
async function reservePayment(order, method, orderAmount) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payment = await prisma.payment.findUnique({
      where: { orderId: order.id },
    });

    if (payment) {
      validateExistingPayment(payment, order, orderAmount);

      if (payment.status === "PENDING" && payment.transectionid) {
        if (payment.method !== method) {
          throw new PaymentRequestError(
            "A different payment method is already pending for this order",
          );
        }
        if (String(payment.transectionid).includes("__")) {
          throw new PaymentRequestError(
            "The pending payment record has an invalid transaction state",
          );
        }
        return {
          payment,
          transactionId: String(payment.transectionid),
          reused: true,
        };
      }

      const transactionId =
        method === "OFF"
          ? `offline-${order.id}`
          : String(await generateTransactionId());
      const updated = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: payment.status,
          transectionid: payment.transectionid,
        },
        data: {
          userId: order.userId,
          method,
          amount: orderAmount,
          transectionid: transactionId,
          status: "PENDING",
        },
      });

      if (updated.count === 1) {
        return {
          payment: await prisma.payment.findUnique({ where: { id: payment.id } }),
          transactionId,
          reused: false,
        };
      }
      continue;
    }

    const transactionId =
      method === "OFF"
        ? `offline-${order.id}`
        : String(await generateTransactionId());
    try {
      const created = await prisma.payment.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          method,
          amount: orderAmount,
          transectionid: transactionId,
          status: "PENDING",
        },
      });
      return { payment: created, transactionId, reused: false };
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }

  throw new PaymentRequestError(
    "Another payment request is being processed. Please try again.",
  );
}

export async function POST(request) {
  try {
    const payload = await authenticate(request);
    if (!payload?.userId) {
      return json({ error: MESSAGES.UNAUTHORIZED }, 401);
    }

    const body = await request.json();
    const actorUserId = Number(payload.userId);
    const orderId = Number(body.orderId);
    const requestedAmount = Number(body.amount);
    const method = Array.isArray(body.method) ? body.method[0] : body.method;

    if (
      !Number.isInteger(actorUserId) ||
      !Number.isInteger(orderId) ||
      orderId < 1 ||
      !Number.isFinite(requestedAmount) ||
      requestedAmount <= 0 ||
      !PAYMENT_METHODS.has(method)
    ) {
      return json({ error: "Invalid payment request" }, 400);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            countryCode: true,
            status: true,
            deleted: true,
          },
        },
      },
    });

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    const isAdmin = await verifyAdmin(request);
    if (!isAdmin && Number(order.userId) !== actorUserId) {
      return json({ error: "Order not found" }, 404);
    }
    if (!order.user || !order.user.status || order.user.deleted) {
      return json({ error: "The order owner is not active" }, 409);
    }
    if (String(order.status || "").toUpperCase() !== "APPROVED") {
      return json(
        { error: "Only an approved, unpaid order can be paid" },
        409,
      );
    }

    const approvedPricing = getApprovedSnapshotTotal(order);
    if (!approvedPricing.ok) {
      return json({ error: approvedPricing.error }, 409);
    }
    if (!amountsMatch(requestedAmount, approvedPricing.total)) {
      return json(
        { error: "Payment amount does not match the approved order total" },
        409,
      );
    }

    const reservation = await reservePayment(
      order,
      method,
      approvedPricing.total,
    );

    if (method === "OFF") {
      return json({
        offline: true,
        idempotent: reservation.reused,
        payment: reservation.payment,
        realTimePaymentData: { message: "" },
      });
    }

    const gateway = requireGatewayConfig();
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", gateway.clientId);
    params.append("client_secret", gateway.clientSecret);

    const authResponse = await fetch(gateway.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const authData = await readJsonResponse(authResponse);
    if (!authResponse.ok || !authData?.access_token) {
      throw new PaymentRequestError(
        "The payment gateway could not authenticate the request. Please try again.",
        502,
      );
    }

    const phone = normalizePhone(order.user);
    const pay = {
      requestorTransactionId: reservation.transactionId,
      debtorName: order.user.name,
      debtorEmailId: order.user.email,
      debtorMobileNumber: phone,
      debtorWhatsAppNumber: phone,
      collectionReferenceNumber: order.id,
      reasonForCollection: String(body.reasonForCollection || "").slice(0, 240),
      initialDueAmount: approvedPricing.total,
      initialDueDate: String(body.initialDueDate || "").slice(0, 40),
      finalDueAmount: approvedPricing.total,
      collectionAmountCurrency: "INR",
      payVia: [method],
      returnUrl: gateway.returnUrl,
    };

    const encryptResponse = await fetch(gateway.encryptionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": gateway.apiKey,
      },
      body: JSON.stringify({
        requestToPay: JSON.stringify(pay),
        encKey: gateway.encryptionKey,
      }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const encryptedData = await encryptResponse.text();
    if (!encryptResponse.ok || !encryptedData) {
      throw new PaymentRequestError(
        "The payment gateway could not prepare the request. Please try again.",
        502,
      );
    }

    const realTimePaymentResponse = await fetch(gateway.requestToPayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": gateway.apiKey,
        Authorization: `Bearer ${authData.access_token}`,
      },
      body: JSON.stringify({ encryptedData }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const realTimePaymentData = await readJsonResponse(realTimePaymentResponse);
    if (!realTimePaymentResponse.ok) {
      throw new PaymentRequestError(
        "The payment gateway rejected the request. Please try again.",
        502,
      );
    }
    if (
      typeof realTimePaymentData?.message !== "string" ||
      !realTimePaymentData.message.startsWith("https://")
    ) {
      throw new PaymentRequestError(
        "The payment gateway did not return a valid payment link",
        502,
      );
    }

    return json({
      realTimePaymentData,
      payment: reservation.payment,
      idempotent: reservation.reused,
    });
  } catch (error) {
    if (error instanceof PaymentRequestError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return json({ error: "Invalid payment request" }, 400);
    }
    console.error("BenePay initiation failed", {
      name: error?.name,
      message: error?.message,
    });
    return json({ error: MESSAGES.SERVER_ERROR }, 500);
  }
}
