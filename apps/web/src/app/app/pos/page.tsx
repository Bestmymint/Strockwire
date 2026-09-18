import { Suspense } from "react";

import { PosManagement } from "@/components/pos-management";

export default function PosPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading point of sale…</p>}>
      <PosManagement />
    </Suspense>
  );
}
