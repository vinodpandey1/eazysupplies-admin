import crypto from "crypto";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { MESSAGES } from "../../../utils/statusConstant";
import {
  amountsMatch,
  getApprovedSnapshotTotal,
  NO_STORE_HEADERS,
  splitTransactionReference,
} from "../paymentValidation";

const prisma = new PrismaClient();
const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

class CallbackError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallbackError";
    this.status = status;
  }
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function safeSecretMatches(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    providedBuffer.length > 0 &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function decryptGatewayResponse(encryptedResponse) {
  if (
    typeof encryptedResponse !== "string" ||
    !encryptedResponse ||
    encryptedResponse.length > 32768
  ) {
    throw new CallbackError("Invalid encrypted payment response");
  }

  const secretKey = String(process.env.EncryptionKey || "");
  if (!/^[0-9a-f]{64}$/i.test(secretKey)) {
    throw new CallbackError("Payment callback verification is not configured", 503);
  }

  try {
    const normalized = encryptedResponse
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const combined = Buffer.from(padded, "base64");
    if (combined.length <= IV_LENGTH + GCM_TAG_LENGTH) {
      throw new Error("Invalid encrypted payload");
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - GCM_TAG_LENGTH);
    const ciphertext = combined.subarray(
      IV_LENGTH,
      combined.length - GCM_TAG_LENGTH,
    );
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(secretKey, "hex"),
      iv,
    );
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted);
  } catch {
    throw new CallbackError("Payment callback verification failed", 401);
  }
}

function normalizeEncryptedCallback(response) {
  const payload = decryptGatewayResponse(response);
  const transaction = splitTransactionReference(
    `${payload?.requestorTransactionId || ""}__${payload?.transactionId || ""}`,
  );
  const orderId = Number(payload?.collectionReferenceNumber);
  const amount = Number(payload?.amountPaid);
  const gatewayStatus = String(payload?.transactionStatus || "").toUpperCase();
  const currency = String(
    payload?.collectionAmountCurrency || payload?.currency || "",
  ).toUpperCase();

  if (!transaction || !Number.isInteger(orderId) || orderId < 1 || !gatewayStatus) {
    throw new CallbackError("Payment response is missing required references");
  }

  return {
    ...transaction,
    orderId,
    amount,
    currency,
    gatewayStatus,
    successful: gatewayStatus === "PAID",
    verifiedBy: "gateway-encryption",
  };
}

function normalizeSignedOrLegacyCallback(request, body) {
  const callbackSecret = String(process.env.PAYMENT_CALLBACK_SECRET || "");
  if (
    callbackSecret &&
    !safeSecretMatches(
      request.headers.get("x-payment-callback-secret"),
      callbackSecret,
    )
  ) {
    throw new CallbackError("Payment callback authentication failed", 401);
  }

  const transaction = splitTransactionReference(body?.transectionid);
  const orderId = Number(body?.orderId);
  const amount = Number(
    body?.amountPaid ?? body?.amount ?? body?.transactionAmt,
  );
  const gatewayStatus = String(body?.status || "").toUpperCase();
  const currency = String(body?.currency || "").toUpperCase();

  if (
    !transaction ||
    !Number.isInteger(orderId) ||
    orderId < 1 ||
    !["SUCCESS", "FAILED"].includes(gatewayStatus)
  ) {
    throw new CallbackError("Improper payment callback data");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CallbackError(
      "The callback must include the exact amount paid",
    );
  }

  return {
    ...transaction,
    orderId,
    amount,
    currency,
    gatewayStatus,
    successful: gatewayStatus === "SUCCESS",
    verifiedBy: callbackSecret ? "shared-secret" : "transaction-binding",
  };
}

function normalizeCallback(request, body) {
  if (typeof body?.response === "string" && body.response) {
    return normalizeEncryptedCallback(body.response);
  }
  return normalizeSignedOrLegacyCallback(request, body);
}

function validateCallbackAgainstPayment(callback, payment) {
  const order = payment?.order;
  if (!order || Number(payment.orderId) !== Number(order.id)) {
    throw new CallbackError("Payment order state is invalid", 409);
  }
  if (Number(payment.userId) !== Number(order.userId)) {
    throw new CallbackError("Payment owner does not match the order owner", 409);
  }
  if (Number(callback.orderId) !== Number(payment.orderId)) {
    throw new CallbackError("Payment order reference does not match", 409);
  }
  if (!["NB"].includes(payment.method)) {
    throw new CallbackError("The payment method does not accept this callback", 409);
  }
  if (
    payment.transectionid !== callback.requestorTransactionId &&
    payment.transectionid !== callback.combinedTransactionId
  ) {
    throw new CallbackError("Payment transaction reference does not match", 409);
  }
  if (
    callback.combinedTransactionId.length > 191 ||
    !callback.providerTransactionId
  ) {
    throw new CallbackError("Payment transaction reference is invalid");
  }
  if (callback.currency && callback.currency !== "INR") {
    throw new CallbackError("Payment currency does not match", 409);
  }

  const approvedPricing = getApprovedSnapshotTotal(order);
  if (!approvedPricing.ok) {
    throw new CallbackError(approvedPricing.error, 409);
  }
  if (!amountsMatch(payment.amount, approvedPricing.total)) {
    throw new CallbackError(
      "Payment amount does not match the approved order total",
      409,
    );
  }
  if (
    callback.successful &&
    (!Number.isFinite(callback.amount) ||
      callback.amount <= 0 ||
      !amountsMatch(callback.amount, approvedPricing.total))
  ) {
    throw new CallbackError("Paid amount does not match the approved order total", 409);
  }

  return approvedPricing;
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const callback = normalizeCallback(request, body);

    const identifiedPayment = await prisma.payment.findFirst({
      where: {
        OR: [
          { transectionid: callback.requestorTransactionId },
          { transectionid: callback.combinedTransactionId },
        ],
      },
      select: { id: true },
    });
    if (!identifiedPayment) {
      return json({ msg: "Payment transaction not found" }, 404);
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: identifiedPayment.id },
        include: { order: true },
      });
      if (!payment) {
        throw new CallbackError("Payment transaction not found", 404);
      }

      validateCallbackAgainstPayment(callback, payment);

      if (!callback.successful) {
        // A declined/cancelled result is acknowledged, but cannot downgrade a
        // successful payment or permanently lock a retry as FAILED.
        return {
          applied: false,
          idempotent: payment.status === "SUCCESS",
          status: callback.gatewayStatus,
        };
      }

      if (payment.status === "SUCCESS") {
        if (
          payment.transectionid === callback.combinedTransactionId &&
          payment.order.status === "PAID"
        ) {
          return { applied: false, idempotent: true, status: "SUCCESS" };
        }
        throw new CallbackError(
          "The successful payment state does not match this callback",
          409,
        );
      }

      if (
        payment.status !== "PENDING" ||
        String(payment.order.status || "").toUpperCase() !== "APPROVED"
      ) {
        throw new CallbackError(
          "Only an approved order with a pending payment can be completed",
          409,
        );
      }

      const paymentUpdate = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: "PENDING",
          transectionid: payment.transectionid,
        },
        data: {
          status: "SUCCESS",
          transectionid: callback.combinedTransactionId,
        },
      });
      if (paymentUpdate.count !== 1) {
        throw new CallbackError(
          "The payment was already processed by another request",
          409,
        );
      }

      const orderUpdate = await tx.order.updateMany({
        where: {
          id: payment.orderId,
          approved: true,
          status: "APPROVED",
        },
        data: { status: "PAID" },
      });
      if (orderUpdate.count !== 1) {
        throw new CallbackError(
          "The order is no longer eligible for payment",
          409,
        );
      }

      return { applied: true, idempotent: false, status: "SUCCESS" };
    });

    return json({
      msg: result.applied
        ? "Payment updated successfully"
        : "Payment callback acknowledged",
      ...result,
    });
  } catch (error) {
    if (error instanceof CallbackError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return json({ error: "Invalid payment callback" }, 400);
    }
    console.error("BenePay callback failed", {
      name: error?.name,
      message: error?.message,
    });
    return json({ error: MESSAGES.SERVER_ERROR }, 500);
  }
}
