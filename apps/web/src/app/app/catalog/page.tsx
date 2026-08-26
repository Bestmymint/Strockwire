import { Suspense } from "react";

import { CatalogManagement } from "@/components/catalog-management";

export default function CatalogPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading catalog…</p>}>
      <CatalogManagement />
    </Suspense>
  );
}
