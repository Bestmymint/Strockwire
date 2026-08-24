import { Suspense } from "react";

import { ApplicationContextShell } from "@/components/application-context-shell";

export default function ApplicationPage() {
  return (
    <Suspense fallback={<p aria-live="polite">Loading workspace…</p>}>
      <ApplicationContextShell />
    </Suspense>
  );
}
