import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../utils/jwt";
import { MESSAGES } from "../utils/statusConstant";
import { csvHasId } from "../utils/offerPricing";

const prisma = new PrismaClient();
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Vary: "Cookie, Authorization, Origin",
};
const json = (body, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

async function requireAdmin(request) {
  const payload = await authenticate(request);
  if (!payload?.userId) return { response: json({ error: MESSAGES.UNAUTHORIZED }, 401) };
  if (!(await verifyAdmin(request))) {
    return { response: json({ error: "Admin access required" }, 403) };
  }
  return { payload };
}

const normalizeCsvIds = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const values = String(value)
    .split(",")
    .map((entry) => Number(entry.trim()));
  if (!values.length || values.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error("INVALID_IDS");
  }
  return [...new Set(values)].join(",");
};

function offerInput(body, { partial = false } = {}) {
  const data = {};
  if (!partial || Object.hasOwn(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("INVALID_NAME");
    data.name = name;
  }
  if (!partial || Object.hasOwn(body, "discount")) {
    const discount = Number(body.discount);
    if (!Number.isInteger(discount) || discount < 0 || discount > 100) {
      throw new Error("INVALID_DISCOUNT");
    }
    data.discount = discount;
  }
  for (const field of ["userId", "categoryId"]) {
    if (!partial || Object.hasOwn(body, field)) data[field] = normalizeCsvIds(body[field]);
  }
  for (const field of ["data", "tag", "remarks"]) {
    if (Object.hasOwn(body, field)) data[field] = body[field];
  }
  if (partial && !Object.keys(data).length) throw new Error("EMPTY_UPDATE");
  return data;
}

function validationResponse(error) {
  const messages = {
    INVALID_IDS: "User and category mappings must contain comma-separated positive IDs.",
    INVALID_NAME: "Offer name is required.",
    INVALID_DISCOUNT: "Discount must be a whole number between 0 and 100.",
    EMPTY_UPDATE: "No supported offer fields were supplied.",
  };
  return messages[error?.message] ? json({ error: messages[error.message] }, 400) : null;
}

// Raw user/category mappings are sensitive and are intentionally admin-only.
export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));
    const userId = Number(searchParams.get("userId"));
    const categoryId = Number(searchParams.get("categoryId"));
    if (searchParams.has("id") && (!Number.isInteger(id) || id < 1)) {
      return json({ error: "A valid offer ID is required." }, 400);
    }

    if (id) {
      const offer = await prisma.offers.findUnique({ where: { id } });
      return offer ? json(offer) : json({ error: "Offer not found" }, 404);
    }

    let offers = await prisma.offers.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (Number.isInteger(userId) && userId > 0) {
      offers = offers.filter((offer) => csvHasId(offer.userId, userId));
    }
    if (Number.isInteger(categoryId) && categoryId > 0) {
      offers = offers.filter((offer) => csvHasId(offer.categoryId, categoryId));
    }
    return json(offers);
  } catch (error) {
    console.error("GET /offers error:", error);
    return json({ error: MESSAGES.SERVER_ERROR }, 500);
  }
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const data = offerInput(await request.json());
    const offer = await prisma.offers.create({
      data: { ...data, author: String(auth.payload.userId) },
    });
    return json(offer, 201);
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    console.error("POST /offers error:", error);
    return json({ error: MESSAGES.SERVER_ERROR }, 500);
  }
}
