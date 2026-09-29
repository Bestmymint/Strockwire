"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import {
  getLatestInsight,
  InsightApiError,
  type InsightCadence,
  type InsightScope,
} from "@/ai-insight-api-client";
import {
  fetchBranches,
  type AccessibleOrganization,
} from "@/branch-api-client";

function period(report: {
  periodStartInclusive: string;
  periodEndExclusive: string;
  reportingTimezone: string;
}) {
  const format = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: report.reportingTimezone,
  });
  return `${format.format(new Date(report.periodStartInclusive))}–${format.format(new Date(Date.parse(report.periodEndExclusive) - 1))}`;
}

function errorMessage(error: unknown) {
  if (error instanceof InsightApiError) {
    if (error.status === 401) return "Sign in again to view AI insights.";
    if (error.status === 403 || error.status === 404)
      return "AI insights are not available for your current access.";
    if (error.status === 400) return "This insight selection is invalid.";
  }
  return "AI insights could not be loaded. Try again later.";
}

export function AiInsightView({
  organization,
  selectedBranchId,
}: {
  organization: AccessibleOrganization;
  selectedBranchId: string | null;
}) {
  const wide = organization.role === "OWNER" || organization.role === "ADMIN";
  const [scopeValue, setScopeValue] = useState(
    wide
      ? "organization"
      : (selectedBranchId ?? organization.branches[0]?.id ?? ""),
  );
  const [cadence, setCadence] = useState<InsightCadence>("DAILY");
  const branchesQuery = useQuery({
    queryKey: ["branches", organization.id, true],
    queryFn: () => fetchBranches(organization.id, true),
    enabled: wide,
  });
  const branches = wide
    ? (branchesQuery.data ?? organization.branches)
    : organization.branches;
  const branch = branches.find((candidate) => candidate.id === scopeValue);
  const scope: InsightScope =
    wide && scopeValue === "organization"
      ? { scope: "organization" }
      : { scope: "branch", branchId: branch?.id ?? "" };
  const enabled = scope.scope === "organization" || scope.branchId !== "";
  const insightQuery = useQuery({
    queryKey: [
      "ai-insights",
      organization.id,
      scope.scope,
      scope.scope === "branch" ? scope.branchId : null,
      cadence,
    ],
    queryFn: ({ signal }) =>
      getLatestInsight(organization.id, scope, cadence, signal),
    enabled,
  });
  const latest = insightQuery.data?.latest;
  const success = insightQuery.data?.lastSuccess;

  return (
    <section aria-label="AI insights" className="space-y-5">
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="text-xl font-semibold">AI insights</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          AI generated summaries of persisted data. Check the deterministic{" "}
          <Link
            className="underline"
            href={`/app/analytics?organizationId=${organization.id}&branchId=${selectedBranchId ?? ""}`}
          >
            analytics views
          </Link>{" "}
          for numerical results.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Insight scope
            <select
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
              onChange={(event) => setScopeValue(event.target.value)}
              value={
                scope.scope === "organization" ? "organization" : scope.branchId
              }
            >
              {wide ? (
                <option value="organization">All organization branches</option>
              ) : null}
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                  {"status" in item && item.status === "INACTIVE"
                    ? " (inactive)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Insight cadence
            <select
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
              onChange={(event) =>
                setCadence(event.target.value as InsightCadence)
              }
              value={cadence}
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
        </div>
        {wide && branchesQuery.isPending ? (
          <p className="mt-2 text-sm" aria-live="polite">
            Loading historical branch choices…
          </p>
        ) : null}
        {wide && branchesQuery.isError ? (
          <p className="mt-2 text-sm" role="alert">
            Historical branch choices could not be loaded.
          </p>
        ) : null}
      </div>

      {!enabled ? (
        <p>Choose an accessible branch to view insights.</p>
      ) : insightQuery.isPending ? (
        <p aria-live="polite">Loading persisted insight…</p>
      ) : insightQuery.isError ? (
        <p role="alert">{errorMessage(insightQuery.error)}</p>
      ) : !latest ? (
        <p className="rounded-lg border bg-card p-4">
          No persisted insight yet for this scope and cadence.
        </p>
      ) : (
        <>
          <div className="rounded-lg border bg-card p-4" role="status">
            <p className="font-medium">
              {latest.state === "SUCCEEDED"
                ? "Latest report succeeded"
                : latest.state === "FAILED"
                  ? "Latest scheduled report failed"
                  : latest.state === "INSUFFICIENT"
                    ? "Latest period had insufficient data for a report"
                    : "Latest report is being prepared"}
            </p>
            <p className="mt-1 text-sm">Latest period: {period(latest)}</p>
            {insightQuery.data.stale && success ? (
              <p className="mt-1 text-sm">
                The newest persisted outcome has no report content. Showing the
                previous successful report below.
              </p>
            ) : null}
            {!success ? (
              <p className="mt-1 text-sm">
                No successful report is available yet.
              </p>
            ) : null}
          </div>
          {success?.content ? (
            <article className="rounded-lg border bg-card p-4 sm:p-5">
              <h3 className="text-lg font-semibold">Successful AI summary</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Report period: {period(success)} · {success.reportingTimezone}
              </p>
              {success.completedAt ? (
                <p className="text-sm text-muted-foreground">
                  Completed{" "}
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: success.reportingTimezone,
                  }).format(new Date(success.completedAt))}
                </p>
              ) : null}
              <p className="mt-4 whitespace-pre-wrap break-words">
                {success.content}
              </p>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
