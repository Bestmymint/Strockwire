import { Suspense } from "react";

import { SalesHistoryManagement } from "@/components/sales-history-management";

export default function SalesHistoryPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading sales history…</p>}>
      <SalesHistoryManagement />
    </Suspense>
  );
}
