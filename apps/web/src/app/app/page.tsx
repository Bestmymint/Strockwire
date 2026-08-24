import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";

export default function ApplicationHoldingPage() {
  return (
    <AuthCard
      description="Your organization and initial branch are ready. Later application workflows are intentionally outside this setup task."
      title="StockWise application"
    >
      <p className="mb-5 text-sm text-muted-foreground">
        Organization setup completed.
      </p>
      <LogoutButton />
    </AuthCard>
  );
}
