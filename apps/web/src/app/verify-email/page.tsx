import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { VerificationForm } from "@/components/auth/verification-form";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authVerifyDescription"
      titleKey="authVerifyTitle"
    >
      <VerificationForm />
    </AuthCardLocalized>
  );
}
