const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : parseJsonArray(parsed);
    } catch {
        return [];
    }
};

export function getOrderItemPricing(order, orderItem, taxes = []) {
    const quantity = Math.max(finiteNumber(orderItem?.quantity), 0);
    const snapshots = parseJsonArray(order?.jsonOrderData);
    const snapshot = snapshots.find(
        (entry) => Number(entry?.productId) === Number(orderItem?.productId)
    ) || {};

    // OrderItem.price is the immutable checkout price. Product.price is only a
    // fallback for legacy records that pre-date order-item price snapshots.
    const unitPrice = finiteNumber(
        snapshot?.price,
        finiteNumber(orderItem?.price, finiteNumber(orderItem?.product?.price))
    );
    const discountPercentage = Math.min(
        Math.max(finiteNumber(snapshot?.discountPercentage), 0),
        100
    );
    const unitDiscount = finiteNumber(
        snapshot?.discountAmount ?? snapshot?._discountAmount,
        unitPrice * discountPercentage / 100
    );
    const sellingPrice = finiteNumber(
        snapshot?.sellingPrice,
        unitPrice - unitDiscount
    );
    const taxPercentage = finiteNumber(
        snapshot?.taxPercentage ?? snapshot?.taxpercent,
        finiteNumber(
            taxes.find((tax) => Number(tax?.id) === Number(orderItem?.product?.tax))?.value
        )
    );
    const unitTax = finiteNumber(
        snapshot?.taxAmount ?? snapshot?.taxamt,
        sellingPrice * taxPercentage / 100
    );

    const lineSubtotal = unitPrice * quantity;
    const lineDiscount = unitDiscount * quantity;
    const taxableSubtotal = sellingPrice * quantity;
    const lineTax = unitTax * quantity;
    // Approved snapshots store totalPrice as the complete line total, not a
    // unit total. Never multiply it by quantity a second time.
    const lineTotal = finiteNumber(
        snapshot?.totalPrice ?? snapshot?.totalprice,
        taxableSubtotal + lineTax
    );

    return {
        quantity,
        unitPrice,
        discountPercentage,
        unitDiscount,
        sellingPrice,
        taxPercentage,
        unitTax,
        lineSubtotal,
        lineDiscount,
        taxableSubtotal,
        lineTax,
        lineTotal,
        snapshot,
    };
}

export function getOrderPricingSummary(order, taxes = []) {
    return (order?.items || []).reduce(
        (summary, item) => {
            const pricing = getOrderItemPricing(order, item, taxes);
            summary.grossSubtotal += pricing.lineSubtotal;
            summary.discount += pricing.lineDiscount;
            summary.tax += pricing.lineTax;
            summary.total += pricing.lineTotal;
            return summary;
        },
        { grossSubtotal: 0, discount: 0, tax: 0, total: 0 }
    );
}

