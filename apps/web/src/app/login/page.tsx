import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthCard
      description="Sign in to continue to the next required setup step."
      title="Sign in"
    >
      <LoginForm />
    </AuthCard>
  );
}
