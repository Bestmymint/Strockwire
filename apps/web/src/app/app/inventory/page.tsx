import { Suspense } from "react";

import { InventoryManagement } from "@/components/inventory-management";

export default function InventoryPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading inventory…</p>}>
      <InventoryManagement />
    </Suspense>
  );
}
