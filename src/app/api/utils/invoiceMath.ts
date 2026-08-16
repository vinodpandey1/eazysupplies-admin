export type InvoiceLine = {
  name: string;
  quantity: number;
  price: number;
  discountPercentage: number;
  discountAmount: number;
  sellingPrice: number;
  taxAmount: number;
  totalPrice: number;
};

export function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseInvoiceItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parseInvoiceItems(parsed) : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeInvoiceLines(value: unknown): InvoiceLine[] {
  return parseInvoiceItems(value).map((raw: any) => {
    const quantity = Math.max(1, finiteNumber(raw?.quantity, 1));
    const price = finiteNumber(raw?.price);
    const discountPercentage = finiteNumber(raw?.discountPercentage);
    const discountAmount = finiteNumber(
      raw?._discountAmount ?? raw?.discountAmount,
      (price * discountPercentage) / 100
    );
    const sellingPrice = finiteNumber(raw?.sellingPrice, price - discountAmount);
    const taxAmount = finiteNumber(raw?.taxamt ?? raw?.taxAmount);
    const totalPrice = finiteNumber(raw?.totalprice ?? raw?.totalPrice, (sellingPrice + taxAmount) * quantity);

    return {
      name: String(raw?.name ?? "Item"),
      quantity,
      price,
      discountPercentage,
      discountAmount,
      sellingPrice,
      taxAmount,
      totalPrice,
    };
  });
}

export function calculateInvoiceTotals(lines: InvoiceLine[]) {
  return lines.reduce(
    (totals, line) => ({
      grossTotal: totals.grossTotal + line.price * line.quantity,
      totalDiscount: totals.totalDiscount + line.discountAmount * line.quantity,
      totalTax: totals.totalTax + line.taxAmount * line.quantity,
      grandTotal: totals.grandTotal + line.totalPrice,
    }),
    { grossTotal: 0, totalDiscount: 0, totalTax: 0, grandTotal: 0 }
  );
}
