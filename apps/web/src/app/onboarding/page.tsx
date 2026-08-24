import { AuthCard } from "@/components/auth/auth-card";
import { OnboardingForm } from "@/components/auth/onboarding-form";

export default function OnboardingPage() {
  return (
    <AuthCard
      description="Complete your profile and create your first organization and branch."
      title="Set up StockWise"
    >
      <OnboardingForm />
    </AuthCard>
  );
}
