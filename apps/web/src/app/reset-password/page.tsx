import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authResetDescription"
      titleKey="authResetTitle"
    >
      <ResetPasswordForm />
    </AuthCardLocalized>
  );
}
