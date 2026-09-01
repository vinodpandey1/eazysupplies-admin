import { NextResponse } from "next/server";
import { parseAuthCookie, verifyJwt } from "../../utils/jwt";
import { sendEmail, createNotification, sendWhatsAppUserReg } from "../../utils/emailUtils";
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
  USER_WELCOME_plainTextMessage: "Hi $userName \n\n Welcome to $brandName!\n\nWe're excited to partner with you on $brandName, your trusted B2B ecommerce platform for streamlining transactions, managing inventory, and connecting with suppliers. Here's a quick guide to get started:\n\n1. **Set Up Your Business Profile**: Go to your account settings to add company details, tax information, and payment methods.\n2. **Explore the Product Catalog**: Browse our extensive catalog of wholesale products and add items to your cart.\n3. **Manage Orders and Invoices**: Use the dashboard to place orders, track shipments, and access invoices.\n\nTo activate your account, click here: $platformUrl/api/auth/login?action=activateUser&email=$userEmail&otp=$otp\n\nIf you have any questions, our support team is here to help at support@$brandName.\n\nLet's grow your business together!\nThe $brandName Team",
  USER_WELCOME_htmlMessage: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Welcome Message</title>\n    <style>\n        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; }\n        .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }\n        h1 { color: #007bff; }\n        ul { padding-left: 20px; }\n        .footer { margin-top: 20px; font-size: 0.9em; color: #666; }\n    </style>\n</head>\n<body>\n    <div class=\"container\">\n  <h1>Hi $userName!</h1>  \n    <h1>Welcome to $brandName!</h1>\n        <p>We're excited to partner with you on $brandName, your trusted B2B ecommerce platform for streamlining transactions, managing inventory, and connecting with suppliers. Here's a quick guide to get started:</p>\n        <ol>\n            <li><strong>Set Up Your Business Profile</strong>: Go to your account settings to add company details, tax information, and payment methods.</li>\n            <li><strong>Explore the Product Catalog</strong>: Browse our extensive catalog of wholesale products and add items to your cart.</li>\n            <li><strong>Manage Orders and Invoices</strong>: Use the dashboard to place orders, track shipments, and access invoices.</li>\n        </ol>\n        <p>To activate your account, <a href=\"$platformUrl/api/auth/login?action=activateUser&email=$userEmail&otp=$otp\">click here</a>.</p>\n        <p>If you have any questions, our support team is here to help at <a href=\"mailto:support@$brandName\">support@$brandName</a>.</p>\n        <p>Let's grow your business together!</p>\n        <div class=\"footer\">The $brandName Team</div>\n    </div>\n</body>\n</html>",
};

/**
 * Authenticate user from JWT in cookies
 * @param {Request} request
 * @returns {object|null} payload
 */
function authenticate(request) {
  const token = parseAuthCookie(request.headers.get("cookie"));
  return token ? verifyJwt(token) : null;
}

/**
 * GET handler - returns authenticated user info
 */

export async function GET(request) {
  const payload = authenticate(request);

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
  let createdUser = null;

  try {
    const body = await request.json();
    let { name, email, phone, countryCode, country_code, gstn, password } = body;
    name = typeof name === "string" ? name.trim() : name;
    email = typeof email === "string" ? email.trim().toLowerCase() : email;
    phone = typeof phone === "string" ? phone.replace(/\D/g, "") : phone;
    gstn = typeof gstn === "string" ? gstn.trim().toUpperCase() : gstn;
    countryCode = String(countryCode || country_code || "91").replace(/\D/g, "") || "91";
    if (typeof phone === "string" && phone.length > 10 && phone.startsWith(countryCode)) {
      phone = phone.slice(countryCode.length);
    }

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

    const conflicts = [];
    if (existingUser) conflicts.push("email address");
    if (existingUser1) conflicts.push("GST number");
    if (existingUser2) conflicts.push("phone number");

    if (conflicts.length) {
      const lastConflict = conflicts.pop();
      const conflictLabel = conflicts.length
        ? `${conflicts.join(", ")} and ${lastConflict}`
        : lastConflict;

      return NextResponse.json(
        {
          error: "Account details already registered",
          message: `An account already exists with this ${conflictLabel}. Please use different details or log in.`,
          conflicts: [...conflicts, lastConflict],
        },
        { status: 409 }
      );
    }

    // Ensure role exists
    const role = await prisma.role.upsert({
      where: { name: "customer" },
      update: {},
      create: { name: "customer" },
    });

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
        status: false,
        roleId: role.id,
      },
    });
    createdUser = newUser;

    const emailsub = "Welcome easysupply.com";
    const userName = newUser.name;
    const userEmail = newUser.email;
    const platformUrl = process.env.PLATFORM_URL || "https://eazysupplies.com";
    const brandName = process.env.BRAND_NAME || "easysupplies.com";
    const replacements = [
      ["$userName", userName],
      ["$userEmail", userEmail],
      ["$otp", String(otp)],
      ["$platformUrl", platformUrl],
      ["$brandName", brandName],
    ];
    const renderMessage = (template) =>
      replacements.reduce(
        (message, [placeholder, value]) => message.replaceAll(placeholder, value),
        template
      );
    const htmlmsg = renderMessage(MESSAGES.USER_WELCOME_htmlMessage);
    const plainmsg = renderMessage(MESSAGES.USER_WELCOME_plainTextMessage);

    // Account creation is the primary operation. Delivery and welcome-offer
    // failures are reported truthfully but must never turn a created account
    // into a 500 response (which led users to retry and see duplicate errors).
    const [emailResult, whatsappResult, notificationResult, offerResult] =
      await Promise.allSettled([
        sendEmail(newUser.email, emailsub, htmlmsg),
        sendWhatsAppUserReg(
          userName,
          newUser.countryCode + newUser.phone,
          userEmail,
          newUser.gstn,
          newUser.otp
        ),
        createNotification(emailsub, newUser.id.toString(), plainmsg),
        (async () => {
          const category = await prisma.category.findFirst({
            where: { name: "DEFAULT" },
          });
          if (!category) return false;
          await prisma.offers.create({
            data: {
              name: "WELCOME-OFFERS-" + newUser.name,
              discount: 0,
              userId: newUser.id.toString(),
              tag: "",
              categoryId: category.id.toString(),
              remarks: "DEFAULT",
            },
          });
          return true;
        })(),
      ]);

    const delivered = (result) =>
      result.status === "fulfilled" && result.value === true;
    const completed = (result) => result.status === "fulfilled";

    return NextResponse.json(
      {
        message: delivered(emailResult)
          ? `${MESSAGES.USER_CREATED}. Please use the activation link sent to your email before logging in.`
          : `${MESSAGES.USER_CREATED}, but the activation email could not be delivered. Please contact support to resend it.`,
        activationRequired: true,
        accountStatus: "inactive_pending_activation",
        delivery: {
          email: delivered(emailResult) ? "sent" : "failed",
          whatsapp: delivered(whatsappResult) ? "sent" : "failed",
          notification: completed(notificationResult) ? "created" : "failed",
        },
        welcomeOffer: completed(offerResult) && offerResult.value === true
          ? "created"
          : "not_created",
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

    // Unique constraints can still race after the preflight checks. Return a
    // deterministic conflict instead of an opaque server error.
    if (error?.code === "P2002") {
      return NextResponse.json(
        {
          error: "Account details already registered",
          message: "An account already exists with this email address, GST number or phone number. Please log in or use different details.",
        },
        { status: 409 }
      );
    }

    // Defensive guarantee: once the account exists, optional post-create work
    // must not cause the client to retry registration.
    if (createdUser) {
      return NextResponse.json(
        {
          message: `${MESSAGES.USER_CREATED}, but activation delivery status could not be confirmed. Please contact support to resend it.`,
          activationRequired: true,
          accountStatus: "inactive_pending_activation",
          delivery: { email: "unknown", whatsapp: "unknown", notification: "unknown" },
          user: {
            email: createdUser.email,
            phone: createdUser.phone,
            gstn: createdUser.gstn,
          },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { error: MESSAGES.SERVER_ERROR },
      { status: 500 }
    );
  }
}
