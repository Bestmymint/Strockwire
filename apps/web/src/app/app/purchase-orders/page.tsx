import { Suspense } from "react";

import { PurchaseOrderManagement } from "@/components/purchase-order-management";

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading purchase orders…</p>}>
      <PurchaseOrderManagement />
    </Suspense>
  );
}
