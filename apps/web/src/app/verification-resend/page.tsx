import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { VerificationResendForm } from "@/components/auth/verification-resend-form";

export default function VerificationResendPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authResendDescription"
      titleKey="authResendTitle"
    >
      <VerificationResendForm />
    </AuthCardLocalized>
  );
}
