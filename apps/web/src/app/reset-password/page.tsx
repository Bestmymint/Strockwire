import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthCard
      description="Choose a new password using the secure link from your email."
      title="Set a new password"
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
