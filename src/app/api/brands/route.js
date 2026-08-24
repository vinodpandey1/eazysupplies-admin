import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyAdmin } from "../utils/jwt";
const prisma = new PrismaClient();

const MESSAGES = {
  UNAUTHORIZED: "Unauthorized",
  MISSING_FIELDS: "Missing required fields.",
  USER_EXISTS: (email) => `User already exists with ${email}`,
  USER_CREATED: "User created successfully",
  SERVER_ERROR: "Internal Server Error",
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('brandId'));
    let res;
    if (id) {
      const res = await prisma.brand.findUnique({
        where: {
          id: id
        }
      })
      return NextResponse.json({ data: res ? res : [] }, { status: 200 });
    }
    res = await prisma.brand.findMany();
    return NextResponse.json({ data: res }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: MESSAGES.SERVER_ERROR }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (verifyAdmin(request)) {
      const body = await request.json();
      return NextResponse.json(await prisma.brand.create({ data: body }), { status: 201 });
    }
  } catch (Error) {
	  console.log(Error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    if (verifyAdmin(request)) {
      const body = await request.json();
      const { searchParams } = new URL(request.url);
      const id = Number(body.id || searchParams.get("brandId"));
      if (!id) {
        return NextResponse.json({ error: "A valid brand id is required." }, { status: 400 });
      }
      const { id: _ignoredId, ...rest } = body;
      return NextResponse.json(await prisma.brand.update({ where: { id }, data: rest }));
    }
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  } catch (Error) {
	  console.log(Error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}
