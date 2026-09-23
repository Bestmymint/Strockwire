import { Suspense } from "react";

import { AnalyticsManagement } from "@/components/analytics-management";

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading analytics…</p>}>
      <AnalyticsManagement />
    </Suspense>
  );
}
