import { Suspense } from "react";
import { SupplierManagement } from "@/components/supplier-management";
export default function SuppliersPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading suppliers…</p>}>
      <SupplierManagement />
    </Suspense>
  );
}
