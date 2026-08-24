import { AuthCard } from "@/components/auth/auth-card";
import { EmailRequestForm } from "@/components/auth/email-request-form";

export default function VerificationResendPage() {
  return (
    <AuthCard
      description="Request a new email verification link."
      title="Verify your email"
    >
      <EmailRequestForm kind="verification" />
    </AuthCard>
  );
}
