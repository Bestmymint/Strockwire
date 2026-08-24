import { Suspense } from "react";

import { MembershipManagement } from "@/components/membership-management";

export default function MembershipManagementPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading members…</p>}>
      <MembershipManagement />
    </Suspense>
  );
}
