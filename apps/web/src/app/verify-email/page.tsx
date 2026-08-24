import { AuthCard } from "@/components/auth/auth-card";
import { VerificationForm } from "@/components/auth/verification-form";

export default function VerifyEmailPage() {
  return (
    <AuthCard
      description="Use the secure link from your verification email to continue."
      title="Verify your email"
    >
      <VerificationForm />
    </AuthCard>
  );
}
