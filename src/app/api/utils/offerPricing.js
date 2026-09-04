const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const clampDiscount = (value) => {
  const discount = Number(value);
  if (!Number.isFinite(discount)) return 0;
  return Math.min(Math.max(discount, 0), 100);
};

export const csvHasId = (value, id) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(String(id));

/**
 * Loads the offer context for an active customer. Offer relations are stored
 * as CSV IDs in the legacy schema, so exact membership is deliberately checked
 * in application code instead of using a substring database filter (where user
 * 6 would incorrectly match 66).
 */
export async function loadCustomerOfferContext(db, userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    return { userId: null, offers: [] };
  }

  const user = await db.user.findFirst({
    where: { id: numericUserId, status: true, deleted: false },
    select: { id: true },
  });
  if (!user) return { userId: null, offers: [] };

  const offers = await db.offers.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return {
    userId: user.id,
    offers: offers.filter((offer) => csvHasId(offer.userId, user.id)),
  };
}

export function findApplicableOffer(offers, userId, categoryId) {
  if (!userId || !categoryId) return null;
  return (
    offers.find(
      (offer) =>
        csvHasId(offer.userId, userId) &&
        csvHasId(offer.categoryId, categoryId),
    ) || null
  );
}

export function calculateCustomerPrice(product, context = {}) {
  const regularPrice = Math.max(Number(product?.price || 0), 0);
  const offer = findApplicableOffer(
    context.offers || [],
    context.userId,
    product?.categoryId,
  );
  const discountPercentage = clampDiscount(offer?.discount);
  const discountAmount = roundMoney(
    (regularPrice * discountPercentage) / 100,
  );
  const effectivePrice = roundMoney(regularPrice - discountAmount);

  return {
    regularPrice,
    effectivePrice,
    discountPercentage,
    discountAmount,
    hasOffer: Boolean(offer && discountPercentage > 0),
    offer,
  };
}

/**
 * Keeps `price` as the immutable catalogue/base price and adds explicit
 * customer-pricing fields. This preserves existing admin/order semantics while
 * allowing the storefront to display and submit the price the customer pays.
 */
export function applyCustomerPrice(product, context = {}) {
  if (!product) return product;
  const pricing = calculateCustomerPrice(product, context);
  if (!pricing.hasOffer) return product;

  const appliedOffer = {
    id: pricing.offer.id,
    name: pricing.offer.name,
    discount: pricing.discountPercentage,
  };

  return {
    ...product,
    sale_price: pricing.effectivePrice,
    effective_price: pricing.effectivePrice,
    regular_price: pricing.regularPrice,
    discount: pricing.discountPercentage,
    customer_discount: pricing.discountPercentage,
    discount_amount: pricing.discountAmount,
    has_offer: true,
    applied_offer: appliedOffer,
    pricing: {
      regular_price: pricing.regularPrice,
      effective_price: pricing.effectivePrice,
      discount_percentage: pricing.discountPercentage,
      discount_amount: pricing.discountAmount,
      has_offer: true,
      offer_id: pricing.offer.id,
      offer_name: pricing.offer.name,
    },
  };
}

export function applyCustomerPrices(products, context = {}) {
  return (products || []).map((product) => applyCustomerPrice(product, context));
}

export const PERSONALIZED_PRICING_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Vary: "Cookie, Authorization, Origin",
  "X-Pricing-Scope": "customer",
};

export const PUBLIC_PRICING_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Vary: "Cookie, Authorization, Origin",
  "X-Pricing-Scope": "public",
};

export function pricingHeaders(context = {}) {
  return context.userId
    ? PERSONALIZED_PRICING_HEADERS
    : PUBLIC_PRICING_HEADERS;
}
