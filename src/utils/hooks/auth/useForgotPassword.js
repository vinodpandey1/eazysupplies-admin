import { emailSchema, YupObject } from "../../validation/ValidationSchemas";
import { useMutation } from "@tanstack/react-query";
import request from "../../axiosUtils";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";

export const ForgotPasswordSchema = YupObject({ email: emailSchema });

const useHandleForgotPassword = (setShowBoxMessage) => {
    const router = useRouter();
    return useMutation({
      mutationFn: (data) => request({
        url: "/auth/password-reset",
        method: "post",
        data: { action: "request", email: data.email, audience: "admin" },
      }, router),
      onSuccess: (response, values) => {
        Cookies.set("ue", values.email, { expires: 1 / 144, path: "/", sameSite: "lax" });
        localStorage.setItem("passwordResetEmail", values.email);
        setShowBoxMessage({ type: "success", message: response?.data?.message || "Verification code sent!" });
        router.push("/auth/otp-verification");
      },
      onError: (error) => {
        setShowBoxMessage({ type: "error", message: error?.response?.data?.error || error.message || "Unable to send verification code" });
      },
    });
};

export default useHandleForgotPassword;
