import { AuthCardLocalized } from "@/components/auth/auth-card-localized";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthCardLocalized
      descriptionKey="authLoginDescription"
      titleKey="authLoginTitle"
    >
      <LoginForm />
    </AuthCardLocalized>
  );
}
