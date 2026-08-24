import { AuthCard } from "@/components/auth/auth-card";
import { RegistrationForm } from "@/components/auth/registration-form";

export default function RegisterPage() {
  return (
    <AuthCard
      description="Create your StockWise account with an email address and password."
      title="Create account"
    >
      <RegistrationForm />
    </AuthCard>
  );
}
