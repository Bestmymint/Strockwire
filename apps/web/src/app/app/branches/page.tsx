import { Suspense } from "react";

import { BranchManagement } from "@/components/branch-management";

export default function BranchManagementPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading branches…</p>}>
      <BranchManagement />
    </Suspense>
  );
}
