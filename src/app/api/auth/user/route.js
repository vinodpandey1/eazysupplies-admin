import { NextResponse } from "next/server";
import { authenticate } from "../../utils/jwt";
import { sendEmail, sendWhatsApp, createNotification, sendWhatsAppUserReg } from "../../utils/emailUtils";
import { hashSync } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Centralized messages
 */
const MESSAGES = {
  UNAUTHORIZED: "Unauthorized",
  MISSING_FIELDS: "Missing required fields.",
  USER_EXISTS: (email) => `User already exists with gstn or phone or email`,
  USER_EXISTS_EMAIL: (email) => `User already exists with  email`,
  USER_EXISTS_GSTN: (gstn) => `User already exists with gstn`,
  USER_EXISTS_PHONE: (phone) => `User already exists with phone`,
  USER_CREATED: "User created successfully",
  SERVER_ERROR: "Internal Server Error",
  USER_WELCOME_plainTextMessage: "Hi $userName \n\n Welcome to $brandName!\n\nWe're excited to partner with you on $brandName, your trusted B2B ecommerce platform for streamlining transactions, managing inventory, and connecting with suppliers. Here's a quick guide to get started:\n\n1. **Set Up Your Business Profile**: Go to your account settings to add company details, tax information, and payment methods.\n2. **Explore the Product Catalog**: Browse our extensive catalog of wholesale products and add items to your cart.\n3. **Manage Orders and Invoices**: Use the dashboard to place orders, track shipments, and access invoices.\n\nYour account is active and ready to use.\n\nIf you have any questions, our support team is here to help at support@$brandName.\n\nLet's grow your business together!\nThe $brandName Team",
  USER_WELCOME_htmlMessage: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Welcome Message</title>\n    <style>\n        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; }\n        .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }\n        h1 { color: #007bff; }\n        ul { padding-left: 20px; }\n        .footer { margin-top: 20px; font-size: 0.9em; color: #666; }\n    </style>\n</head>\n<body>\n    <div class=\"container\">\n  <h1>Hi $userName!</h1>  \n    <h1>Welcome to $brandName!</h1>\n        <p>We're excited to partner with you on $brandName, your trusted B2B ecommerce platform for streamlining transactions, managing inventory, and connecting with suppliers. Here's a quick guide to get started:</p>\n        <ol>\n            <li><strong>Set Up Your Business Profile</strong>: Go to your account settings to add company details, tax information, and payment methods.</li>\n            <li><strong>Explore the Product Catalog</strong>: Browse our extensive catalog of wholesale products and add items to your cart.</li>\n            <li><strong>Manage Orders and Invoices</strong>: Use the dashboard to place orders, track shipments, and access invoices.</li>\n        </ol>\n        <p>Your account is active and ready to use.</p>\n        <p>If you have any questions, our support team is here to help at <a href=\"mailto:support@$brandName\">support@$brandName</a>.</p>\n        <p>Let's grow your business together!</p>\n        <div class=\"footer\">The $brandName Team</div>\n    </div>\n</body>\n</html>",
};

/**
 * GET handler - returns authenticated user info
 */

export async function GET(request) {
  const payload = await authenticate(request);

  if (!payload) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const getOnlyProfile = Number(searchParams.get('getOnlyProfile'));

  if (getOnlyProfile) {
    const res = await prisma.user.findUnique({
      where: { email: payload.email }
    });

    return NextResponse.json(
      { data: res },
      { status: 200 }
    );
  }

  const userSelect = {
    id: true,
    name: true,
    email: true,
    roleId: true,
    status: true,
    profileImagepath: true,
    lastLoginDt: true,
    countryCode: true,
    phone: true,
    role: true, // will include related Role object
    orders: true, // will include related Orders
    cart: true,
    otp: true,
    payments: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    wishlist: true,
    favorite: true,
    gstn: true,
    bankDetails: true,
  };

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: userSelect,
  });

  return NextResponse.json(
    { userId: payload.userId, username: payload.email, data: user },
    { status: 200 }
  );
}

export async function POST(request) {
  try {
    const body = await request.json();
    let { name, email, phone, countryCode, gstn, password } = body;
    countryCode = countryCode ? countryCode : "91";

    // Validate required fields
    if (!name || !email || !phone || !gstn || !password || !countryCode) {
      return NextResponse.json(
        { error: MESSAGES.MISSING_FIELDS },
        { status: 400 }
      );
    }

    // Check if user already exists (matching all identifiers)
    let existingUser, existingUser1, existingUser2;
    if (email) existingUser = await prisma.user.findUnique({ where: { email } });
    if (gstn) existingUser1 = await prisma.user.findFirst({ where: { gstn } });
    if (phone) existingUser2 = await prisma.user.findFirst({ where: { phone } });

    if (existingUser || existingUser1 || existingUser2) {
      return NextResponse.json(
        { message: existingUser ? MESSAGES.USER_EXISTS_EMAIL : existingUser1 ? MESSAGES.USER_EXISTS_GSTN : existingUser2 ? MESSAGES.USER_EXISTS_PHONE : NULL},
        { status: 409 }
      );
    }

    // Ensure role exists
    const role =
      (await prisma.role.findUnique({ where: { name: "customer" } })) ||
      (await prisma.role.create({ data: { name: "customer" } }));

    // Hash password
    const hashedPassword = hashSync(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        countryCode,
        gstn,
        password: hashedPassword,
        otp,
        status: true,
        roleId: role.id,
      },
    });
    let category = await prisma.category.findFirst({ where: { name: "DEFAULT" } });
    let addOffer = await prisma.offers.create({
      data : {
        "name": "WELCOME-OFFERS-"+newUser?.name,
      "discount": 0,
      "userId": newUser?.id.toString(),
      "tag": "",
      "categoryId": category?.id.toString(),
      "remarks": "DEFAULT"
      }
    });
    if (newUser) {
      const emailsub = "Welcome easysupply.com";
      let userName = newUser.name;
      let userEmail = newUser.email;
      let htmlmsg = MESSAGES.USER_WELCOME_htmlMessage;
      let plainmsg = MESSAGES.USER_WELCOME_plainTextMessage;
      htmlmsg = htmlmsg.replaceAll("$userName", userName).replaceAll("$userEmail", userEmail).replaceAll("$otp", otp).replaceAll("$platformUrl", process.env.PLATFORM_URL).replaceAll("$brandName", process.env.BRAND_NAME);
      plainmsg = plainmsg.replaceAll("$userName", userName).replaceAll("$userEmail", userEmail).replaceAll("$otp", otp).replaceAll("$platformUrl", process.env.PLATFORM_URL).replaceAll("$brandName", process.env.BRAND_NAME);
      await sendEmail(newUser.email, emailsub, htmlmsg);
      await sendWhatsAppUserReg(userName, newUser.countryCode + newUser.phone, userEmail, newUser.gstn, newUser.otp);
      sendWhatsApp(newUser.countryCode + newUser.phone, "text", plainmsg);
      createNotification(emailsub, newUser.id.toString(), plainmsg);
    }

    return NextResponse.json(
      {
        message: MESSAGES.USER_CREATED,
        user: {
          email: newUser.email,
          phone: newUser.phone,
          gstn: newUser.gstn,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[USER_POST_ERROR]", error);
    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}
