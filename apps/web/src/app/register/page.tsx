import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { RegistrationForm } from "@/components/auth/registration-form";

export default function RegisterPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authRegisterDescription"
      titleKey="authRegisterTitle"
    >
      <RegistrationForm />
    </AuthCardLocalized>
  );
}
