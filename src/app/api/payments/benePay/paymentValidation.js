export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function amountsMatch(left, right) {
  const leftAmount = Number(left);
  const rightAmount = Number(right);
  return (
    Number.isFinite(leftAmount) &&
    Number.isFinite(rightAmount) &&
    Math.abs(roundMoney(leftAmount) - roundMoney(rightAmount)) <= 0.01
  );
}

function parseSnapshot(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Payment is allowed only against the immutable line totals persisted by the
 * admin approval flow. Product prices are deliberately not consulted here.
 */
export function getApprovedSnapshotTotal(order) {
  if (!order?.approved) {
    return { ok: false, error: "The order must be approved before payment" };
  }

  const snapshot = parseSnapshot(order.jsonOrderData);
  if (!snapshot?.length) {
    return {
      ok: false,
      error: "The approved order does not have a final pricing snapshot",
    };
  }

  let total = 0;
  for (const line of snapshot) {
    const productId = Number(line?.productId);
    const quantity = Number(line?.quantity);
    const lineTotal = Number(line?.totalPrice);

    if (
      !Number.isInteger(productId) ||
      productId < 1 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !Number.isFinite(lineTotal) ||
      lineTotal < 0
    ) {
      return {
        ok: false,
        error: "The approved order pricing snapshot is invalid",
      };
    }

    total = roundMoney(total + lineTotal);
  }

  if (!Number.isFinite(total) || total <= 0) {
    return {
      ok: false,
      error: "The approved order total is invalid",
    };
  }

  return { ok: true, total, snapshot };
}

export function splitTransactionReference(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const separator = trimmed.indexOf("__");

  if (separator < 1 || separator === trimmed.length - 2) return null;

  const requestorTransactionId = trimmed.slice(0, separator).trim();
  const providerTransactionId = trimmed.slice(separator + 2).trim();
  if (!requestorTransactionId || !providerTransactionId) return null;

  return {
    requestorTransactionId,
    providerTransactionId,
    combinedTransactionId: `${requestorTransactionId}__${providerTransactionId}`,
  };
}
