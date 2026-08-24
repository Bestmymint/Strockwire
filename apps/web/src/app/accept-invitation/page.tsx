import { AuthCard } from "@/components/auth/auth-card";
import { InvitationAcceptanceForm } from "@/components/auth/invitation-acceptance-form";

export default function AcceptInvitationPage() {
  return (
    <AuthCard
      description="Use the secure invitation link sent to your email."
      title="Accept organization invitation"
    >
      <InvitationAcceptanceForm />
    </AuthCard>
  );
}
