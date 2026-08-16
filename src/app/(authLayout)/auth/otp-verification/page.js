"use client";

import ShowBox from "@/elements/alerts&Modals/ShowBox";
import LoginBoxWrapper from "@/utils/hoc/LoginBoxWrapper";
import request from "@/utils/axiosUtils";
import Cookies from "js-cookie";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "reactstrap";

const OtpVerification = () => {
  const router = useRouter();
  const { t } = useTranslation("common");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showBoxMessage, setShowBoxMessage] = useState();

  useEffect(() => {
    const resetEmail = Cookies.get("ue") || localStorage.getItem("passwordResetEmail") || "";
    setEmail(resetEmail);
    if (!resetEmail) router.replace("/auth/forgot-password");
  }, [router]);

  const resetPassword = async () => {
    if (!/^\d{6}$/.test(otp)) {
      return setShowBoxMessage({ type: "error", message: "Enter the 6-digit verification code" });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return setShowBoxMessage({ type: "error", message: "Password must be at least 8 characters and include an uppercase letter and number" });
    }
    if (password !== confirmPassword) {
      return setShowBoxMessage({ type: "error", message: "Passwords do not match" });
    }

    try {
      setLoading(true);
      const response = await request({
        url: "/auth/password-reset",
        method: "post",
        data: { action: "reset", email, otp, password, audience: "admin" },
      }, router);
      setShowBoxMessage({ type: "success", message: response?.data?.message || "Password updated successfully" });
      Cookies.remove("ue", { path: "/" });
      localStorage.removeItem("passwordResetEmail");
      setTimeout(() => router.replace("/auth/login"), 900);
    } catch (error) {
      setShowBoxMessage({ type: "error", message: error?.response?.data?.error || "Unable to reset password" });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      setLoading(true);
      const response = await request({
        url: "/auth/password-reset",
        method: "post",
        data: { action: "request", email, audience: "admin" },
      }, router);
      setShowBoxMessage({ type: "success", message: response?.data?.message || "Verification code resent" });
    } catch (error) {
      setShowBoxMessage({ type: "error", message: error?.response?.data?.error || "Unable to resend code" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="box-wrapper">
      <ShowBox showBoxMessage={showBoxMessage} />
      <LoginBoxWrapper>
        <div className="log-in-title">
          <h3>{t("ResetPassword") || "Reset Password"}</h3>
          <h5>Enter the code sent to {email || "your email"} and choose a new password.</h5>
        </div>
        <div className="input-box d-grid gap-3">
          <Input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit verification code" />
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" />
          <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" />
          <button className="btn btn-animation w-100" type="button" onClick={resetPassword} disabled={loading}>Reset Password</button>
          <button className="btn btn-link" type="button" onClick={resend} disabled={loading}>Resend verification code</button>
          <Link href="/auth/login" className="text-center">Back to login</Link>
        </div>
      </LoginBoxWrapper>
    </div>
  );
};

export default OtpVerification;
