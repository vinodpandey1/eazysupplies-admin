import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";
import { sendEmail } from "../../utils/emailUtils";

const prisma = new PrismaClient();

const otpEmail = (name, otp) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
    <h2>Password reset request</h2>
    <p>Hello ${name},</p>
    <p>Use the verification code below to reset your Eazy Supplies password:</p>
    <p style="font-size:30px;font-weight:700;letter-spacing:6px">${otp}</p>
    <p>If you did not request this change, you can safely ignore this email.</p>
  </div>`;

export async function POST(request) {
  try {
    const { action, email: rawEmail, otp, password, audience = "customer" } = await request.json();
    const email = rawEmail?.trim().toLowerCase();

    if (!email || !["customer", "admin"].includes(audience)) {
      return NextResponse.json({ error: "A valid email and account type are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
    const roleName = user?.role?.name?.toLowerCase();
    const roleMatches = audience === "admin" ? roleName === "admin" : roleName === "customer";

    if (!user || !roleMatches || user.deleted) {
      return NextResponse.json({ error: `No active ${audience} account exists for this email` }, { status: 404 });
    }

    if (action === "request") {
      const resetOtp = Math.floor(100000 + Math.random() * 900000);
      await prisma.user.update({ where: { id: user.id }, data: { otp: resetOtp } });
      await sendEmail(user.email, "Eazy Supplies password reset", otpEmail(user.name, resetOtp));
      return NextResponse.json({ message: "Verification code sent to your email" });
    }

    if (action === "reset") {
      if (!/^\d{6}$/.test(String(otp || ""))) {
        return NextResponse.json({ error: "Enter the 6-digit verification code" }, { status: 400 });
      }
      if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return NextResponse.json({ error: "Password must be at least 8 characters and include an uppercase letter and number" }, { status: 400 });
      }
      if (user.otp !== Number(otp)) {
        return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashSync(password, 10), otp: 0 },
      });
      return NextResponse.json({ message: "Password updated successfully" });
    }

    return NextResponse.json({ error: "Invalid password reset action" }, { status: 400 });
  } catch (error) {
    console.error("[PASSWORD_RESET_ERROR]", error);
    return NextResponse.json({ error: "Unable to process password reset right now" }, { status: 500 });
  }
}
