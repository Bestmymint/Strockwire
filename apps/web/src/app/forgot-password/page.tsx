import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { EmailRequestForm } from "@/components/auth/email-request-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authForgotDescription"
      titleKey="authForgotTitle"
    >
      <EmailRequestForm kind="password_reset" />
    </AuthCardLocalized>
  );
}
