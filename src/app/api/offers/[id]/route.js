import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin } from "../../utils/jwt";
import { MESSAGES } from "../../utils/statusConstant";

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
  const values = String(value).split(",").map((entry) => Number(entry.trim()));
  if (!values.length || values.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error("INVALID_IDS");
  }
  return [...new Set(values)].join(",");
};

function updateInput(body) {
  const data = {};
  if (Object.hasOwn(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("INVALID_NAME");
    data.name = name;
  }
  if (Object.hasOwn(body, "discount")) {
    const discount = Number(body.discount);
    if (!Number.isInteger(discount) || discount < 0 || discount > 100) {
      throw new Error("INVALID_DISCOUNT");
    }
    data.discount = discount;
  }
  for (const field of ["userId", "categoryId"]) {
    if (Object.hasOwn(body, field)) data[field] = normalizeCsvIds(body[field]);
  }
  for (const field of ["data", "tag", "remarks"]) {
    if (Object.hasOwn(body, field)) data[field] = body[field];
  }
  if (!Object.keys(data).length) throw new Error("EMPTY_UPDATE");
  return data;
}

const parseId = async (params) => {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function failure(error, operation) {
  const messages = {
    INVALID_IDS: "User and category mappings must contain comma-separated positive IDs.",
    INVALID_NAME: "Offer name is required.",
    INVALID_DISCOUNT: "Discount must be a whole number between 0 and 100.",
    EMPTY_UPDATE: "No supported offer fields were supplied.",
  };
  if (messages[error?.message]) return json({ error: messages[error.message] }, 400);
  if (error?.code === "P2025") return json({ error: "Offer not found" }, 404);
  console.error(`${operation} /offers/[id] error:`, error);
  return json({ error: MESSAGES.SERVER_ERROR }, 500);
}

export async function GET(request, { params }) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const id = await parseId(params);
    if (!id) return json({ error: "A valid offer ID is required." }, 400);
    const offer = await prisma.offers.findUnique({ where: { id } });
    return offer ? json(offer) : json({ error: "Offer not found" }, 404);
  } catch (error) {
    return failure(error, "GET");
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const id = await parseId(params);
    if (!id) return json({ error: "A valid offer ID is required." }, 400);
    const offer = await prisma.offers.update({
      where: { id },
      data: updateInput(await request.json()),
    });
    return json(offer);
  } catch (error) {
    return failure(error, "PUT");
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const id = await parseId(params);
    if (!id) return json({ error: "A valid offer ID is required." }, 400);
    await prisma.offers.delete({ where: { id } });
    return json({ message: "Offer deleted successfully" });
  } catch (error) {
    return failure(error, "DELETE");
  }
}
