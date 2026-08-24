import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";

export default function OnboardingHoldingPage() {
  return (
    <AuthCard
      description="Profile and organization setup is the next workflow and will be available in P2-M3."
      title="Continue setup"
    >
      <LogoutButton />
    </AuthCard>
  );
}
