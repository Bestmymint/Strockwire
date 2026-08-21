"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchApiHealth } from "@/api-client";

export function ApiHealthStatus() {
  const healthQuery = useQuery({
    queryFn: fetchApiHealth,
    queryKey: ["api", "health"],
    retry: false,
  });

  if (healthQuery.isPending) {
    return <p aria-live="polite">Checking the Express API connection…</p>;
  }

  if (healthQuery.isError) {
    return (
      <p aria-live="polite">
        The Express API connection is unavailable. Start the API development
        server and refresh this page.
      </p>
    );
  }

  return <p aria-live="polite">Express API connection verified.</p>;
}
