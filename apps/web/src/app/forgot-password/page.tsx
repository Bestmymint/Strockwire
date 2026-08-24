import { AuthCard } from "@/components/auth/auth-card";
import { EmailRequestForm } from "@/components/auth/email-request-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      description="Request a secure password reset link."
      title="Reset your password"
    >
      <EmailRequestForm kind="password_reset" />
    </AuthCard>
  );
}
