"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AnalyticsApiError,
  type AnalyticsCategoryBucket,
  type AnalyticsPeriod,
  type AnalyticsRequest,
  type AnalyticsSalesBucket,
  getAnalyticsBranches,
  getAnalyticsCategories,
  getAnalyticsSales,
} from "@/analytics-api-client";
import { formatThb } from "@/money-display";
import { resolveApplicationContext } from "@/application-context";
import { AiInsightView } from "@/components/ai-insight-view";
import { InventoryAnalyticsView } from "@/components/inventory-analytics-view";
import { ForecastReorderView } from "@/components/forecast-reorder-view";
import {
  fetchAccessContext,
  type AccessibleOrganization,
} from "@/branch-api-client";

type View =
  | "sales"
  | "categories"
  | "branches"
  | "inventory"
  | "forecast-reorder"
  | "insights";

function initialPeriod(): AnalyticsPeriod {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 6);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    granularity: "day",
  };
}

function money(value: string): string {
  return formatThb(value, true);
}

function reasonText(reason: string | null): string {
  const messages: Record<string, string> = {
    INCOMPLETE_COST_COVERAGE: "Cost coverage is incomplete",
    NO_BASELINE: "No comparison baseline",
    NON_COMPARABLE_PERIOD: "Period cannot be compared",
    NON_POSITIVE_NET_SALES: "Net sales is not positive",
    NO_REGISTERED_REFUNDS: "No registered refunds",
    NO_REGISTERED_SALES: "No registered sales",
    NO_SALES: "No sales",
  };
  return reason === null ? "Unavailable" : (messages[reason] ?? "Unavailable");
}

function nullable(
  value: { value: string | null; reason: string | null },
  format: "money" | "percent",
) {
  return value.value === null
    ? reasonText(value.reason)
    : format === "money"
      ? money(value.value)
      : `${value.value}%`;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof AnalyticsApiError))
    return "Analytics could not be loaded. Try again.";
  switch (error.kind) {
    case "authentication_required":
      return "Sign in again to view analytics.";
    case "forbidden":
      return "Analytics is not available for your current access.";
    case "invalid_cursor":
      return "This page can no longer be continued. Restart this list.";
    case "validation":
      return "Check the period and scope, then try again. Week starts on Monday; month and year ranges must align with calendar boundaries and span at most 366 days.";
    case "configuration":
      return "Analytics reporting time needs configuration. Ask an administrator to check it.";
    default:
      return "Analytics could not be loaded. Try again.";
  }
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 break-words text-xl font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function DetailMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SalesMetrics({ bucket }: { bucket: AnalyticsSalesBucket }) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Net sales" value={money(bucket.netSalesAmount)} />
        <Metric label="Gross sales" value={money(bucket.grossSalesAmount)} />
        <Metric label="Refund amount" value={money(bucket.refundAmount)} />
        <Metric label="Sales" value={bucket.saleCount} />
      </dl>
      <dl className="grid gap-x-8 rounded-lg border bg-card px-4 py-2 text-sm sm:grid-cols-2">
        <DetailMetric label="Discount" value={money(bucket.discountAmount)} />
        <DetailMetric
          label="Sales after discount"
          value={money(bucket.salesAfterDiscountAmount)}
        />
        <DetailMetric label="Refunds" value={bucket.refundCount} />
        <DetailMetric label="Refunded sales" value={bucket.refundedSaleCount} />
        <DetailMetric
          label="Average order value"
          value={nullable(bucket.averageOrderValue, "money")}
        />
        <DetailMetric
          label="Net sales growth"
          value={nullable(bucket.netSalesGrowthPercent, "percent")}
        />
        <DetailMetric
          label="Output VAT"
          value={money(bucket.outputVatAmount)}
        />
        <DetailMetric
          label="Net output VAT"
          value={money(bucket.netOutputVatAmount)}
        />
      </dl>
      <details className="rounded-lg border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          Tax and refund detail
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt>Registered taxable sales</dt>
            <dd className="font-medium">
              {nullable(bucket.registeredTaxableSalesAmount, "money")}
            </dd>
          </div>
          <div>
            <dt>Refunded registered taxable sales</dt>
            <dd className="font-medium">
              {nullable(bucket.refundedRegisteredTaxableAmount, "money")}
            </dd>
          </div>
          <div>
            <dt>Refunded discount</dt>
            <dd className="font-medium">
              {money(bucket.refundedDiscountAmount)}
            </dd>
          </div>
          <div>
            <dt>Refunded output VAT</dt>
            <dd className="font-medium">
              {money(bucket.refundedOutputVatAmount)}
            </dd>
          </div>
        </dl>
      </details>
      {bucket.cost ? (
        <section aria-label="Cost and profit" className="space-y-3">
          <div>
            <h3 className="font-semibold">Cost and profit</h3>
            <p className="text-sm text-muted-foreground">
              Cost coverage: {bucket.cost.costCoverage}
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Net COGS"
              value={nullable(bucket.cost.netCogsAmount, "money")}
            />
            <Metric
              label="Gross profit"
              value={nullable(bucket.cost.grossProfitAmount, "money")}
            />
            <Metric
              label="Gross margin"
              value={nullable(bucket.cost.grossMarginPercent, "percent")}
            />
          </dl>
          <details className="rounded-lg border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              Cost detail
            </summary>
            <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
              <DetailMetric
                label="Sale COGS"
                value={money(bucket.cost.saleCogsAmount)}
              />
              <DetailMetric
                label="Refund COGS reversal"
                value={money(bucket.cost.refundCogsReversalAmount)}
              />
              <DetailMetric
                label="Known net COGS"
                value={money(bucket.cost.knownNetCogsAmount)}
              />
              <DetailMetric
                label="Known cost lines"
                value={bucket.cost.knownCostLineCount}
              />
              <DetailMetric
                label="Unknown cost lines"
                value={bucket.cost.unknownCostLineCount}
              />
            </dl>
          </details>
        </section>
      ) : null}
    </>
  );
}

function NetSalesChart({
  buckets,
}: {
  buckets: readonly AnalyticsSalesBucket[];
}) {
  const chartData = buckets.map((bucket) => ({
    label: bucket.label,
    netSales: Number(bucket.netSalesAmount),
    exact: bucket.netSalesAmount,
  }));
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-semibold">Net sales trend</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        THB by reporting period. Exact values are in the table below.
      </p>
      <div
        aria-label="Net sales trend chart"
        role="img"
        className="h-64 w-full min-w-0"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 1, height: 256 }}
          minWidth={1}
          minHeight={1}
        >
          <LineChart
            data={chartData}
            accessibilityLayer
            margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" minTickGap={24} />
            <YAxis width={70} />
            <Tooltip
              formatter={(_value, _name, item) =>
                money(String(item.payload.exact))
              }
            />
            <Line
              type="linear"
              dataKey="netSales"
              name="Net sales"
              stroke="#2563eb"
              strokeWidth={2}
              dot={chartData.length <= 15}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SalesSeriesTable({
  buckets,
}: {
  buckets: readonly AnalyticsSalesBucket[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[700px] text-left text-sm">
        <caption className="px-4 py-3 text-left font-semibold">
          Sales by period
        </caption>
        <thead className="border-y bg-muted text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Period</th>
            <th className="px-4 py-2">Net sales</th>
            <th className="px-4 py-2">Gross sales</th>
            <th className="px-4 py-2">Refunds</th>
            <th className="px-4 py-2">Sales</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr
              className="border-b last:border-0"
              key={bucket.localStartInclusive}
            >
              <th className="px-4 py-2 font-medium">{bucket.label}</th>
              <td className="px-4 py-2 tabular-nums">
                {money(bucket.netSalesAmount)}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {money(bucket.grossSalesAmount)}
              </td>
              <td className="px-4 py-2 tabular-nums">{bucket.refundCount}</td>
              <td className="px-4 py-2 tabular-nums">{bucket.saleCount}</td>
              <td className="px-4 py-2">{bucket.dataStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategorySeriesTable({
  buckets,
}: {
  buckets: readonly AnalyticsCategoryBucket[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full min-w-[650px] text-left text-sm">
        <thead className="border-y bg-muted">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2">Gross sales</th>
            <th className="px-3 py-2">Discount</th>
            <th className="px-3 py-2">Sales after discount</th>
            <th className="px-3 py-2">Refund</th>
            <th className="px-3 py-2">Net sales</th>
            <th className="px-3 py-2">Share</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr
              key={bucket.localStartInclusive}
              className="border-b last:border-0"
            >
              <th className="px-3 py-2">{bucket.label}</th>
              <td className="px-3 py-2">{money(bucket.grossSalesAmount)}</td>
              <td className="px-3 py-2">{money(bucket.discountAmount)}</td>
              <td className="px-3 py-2">
                {money(bucket.salesAfterDiscountAmount)}
              </td>
              <td className="px-3 py-2">{money(bucket.refundAmount)}</td>
              <td className="px-3 py-2">{money(bucket.netSalesAmount)}</td>
              <td className="px-3 py-2">
                {nullable(bucket.categorySharePercent, "percent")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          StockWise / Reporting
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Analytics
        </h1>
      </div>
      {children}
    </section>
  );
}

export function AnalyticsManagement() {
  const searchParams = useSearchParams();
  const contextQuery = useQuery({
    queryKey: ["access-context"],
    queryFn: fetchAccessContext,
  });
  const resolved = contextQuery.data
    ? resolveApplicationContext(
        contextQuery.data,
        searchParams.get("organizationId"),
        searchParams.get("branchId"),
      )
    : null;
  if (contextQuery.isPending)
    return (
      <PageFrame>
        <p aria-live="polite">Loading access…</p>
      </PageFrame>
    );
  if (contextQuery.isError)
    return (
      <PageFrame>
        <p className="form-message" role="alert">
          Your access context could not be loaded.
        </p>
      </PageFrame>
    );
  if (!resolved?.organization)
    return (
      <PageFrame>
        <p>Choose an active organization before viewing analytics.</p>
        <Link href="/app" className="underline">
          Return to workspace
        </Link>
      </PageFrame>
    );
  if (resolved.organization.role === "CASHIER")
    return (
      <PageFrame>
        <p className="form-message" role="alert">
          Analytics is not available for your current access.
        </p>
        <Link href="/app" className="underline">
          Return to workspace
        </Link>
      </PageFrame>
    );
  return (
    <AnalyticsContent
      key={`${resolved.organization.id}:${resolved.organization.role}:${resolved.organization.branches.map((branch) => branch.id).join(",")}`}
      organization={resolved.organization}
      selectedBranchId={resolved.branch?.id ?? null}
    />
  );
}

function AnalyticsContent({
  organization,
  selectedBranchId,
}: {
  organization: AccessibleOrganization;
  selectedBranchId: string | null;
}) {
  const [draftPeriod, setDraftPeriod] =
    useState<AnalyticsPeriod>(initialPeriod);
  const [period, setPeriod] = useState<AnalyticsPeriod>(draftPeriod);
  const [scopeValue, setScopeValue] = useState("organization");
  const [view, setView] = useState<View>(
    organization.role === "INVENTORY_STAFF" ? "inventory" : "sales",
  );
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [categoryReset, setCategoryReset] = useState(0);
  const [branchReset, setBranchReset] = useState(0);
  const isWideRole =
    organization.role === "OWNER" || organization.role === "ADMIN";
  const allowedBranches = organization.branches;
  const effectiveScope =
    isWideRole && scopeValue === "organization"
      ? { scope: "organization" as const }
      : {
          scope: "branch" as const,
          branchId:
            allowedBranches.find((branch) => branch.id === scopeValue)?.id ??
            allowedBranches[0]?.id ??
            "",
        };
  const enabled =
    period.from < period.to &&
    (effectiveScope.scope === "organization" || effectiveScope.branchId !== "");
  const request: AnalyticsRequest = {
    organizationId: organization.id,
    ...period,
    ...effectiveScope,
  };
  const queryRoot = [
    "analytics",
    organization.id,
    effectiveScope.scope,
    effectiveScope.scope === "branch" ? effectiveScope.branchId : null,
    period.from,
    period.to,
    period.granularity,
  ] as const;
  const salesQuery = useQuery({
    queryKey: [...queryRoot, "sales"],
    queryFn: ({ signal }) => getAnalyticsSales(request, signal),
    enabled:
      enabled &&
      view !== "inventory" &&
      view !== "forecast-reorder" &&
      view !== "insights",
  });
  const categoryQuery = useInfiniteQuery({
    queryKey: [...queryRoot, "categories", categoryReset],
    queryFn: ({ signal, pageParam }) =>
      getAnalyticsCategories(request, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.meta.nextCursor ?? undefined,
    enabled: enabled && view === "categories",
  });
  const branchQuery = useInfiniteQuery({
    queryKey: [...queryRoot, "branches", branchReset],
    queryFn: ({ signal, pageParam }) =>
      getAnalyticsBranches(request, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.meta.nextCursor ?? undefined,
    enabled: enabled && view === "branches",
  });
  const buckets = salesQuery.data?.data.buckets ?? [];
  const activeBucket =
    buckets.find((bucket) => bucket.localStartInclusive === selectedBucket) ??
    buckets.at(-1);
  const activeIndex = activeBucket ? buckets.indexOf(activeBucket) : -1;

  return (
    <PageFrame>
      <p className="text-sm text-muted-foreground">
        Analytics for {organization.name}.
      </p>
      <form
        hidden={view === "forecast-reorder" || view === "insights"}
        className="rounded-lg border bg-card p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedBucket(null);
          setPeriod(draftPeriod);
        }}
      >
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-[12rem_12rem_10rem_minmax(0,1fr)]">
          <label className="form-field">
            From (inclusive)
            <input
              required
              type="date"
              value={draftPeriod.from}
              onChange={(event) =>
                setDraftPeriod({ ...draftPeriod, from: event.target.value })
              }
              className="form-control form-control--date"
            />
          </label>
          <label className="form-field">
            To (exclusive)
            <input
              required
              type="date"
              value={draftPeriod.to}
              onChange={(event) =>
                setDraftPeriod({ ...draftPeriod, to: event.target.value })
              }
              className="form-control form-control--date"
            />
          </label>
          <label className="form-field">
            Granularity
            <select
              value={draftPeriod.granularity}
              onChange={(event) =>
                setDraftPeriod({
                  ...draftPeriod,
                  granularity: event.target
                    .value as AnalyticsPeriod["granularity"],
                })
              }
              className="form-control"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          <label className="form-field">
            Scope
            <select
              aria-label="Analytics scope"
              value={
                effectiveScope.scope === "organization"
                  ? "organization"
                  : effectiveScope.branchId
              }
              onChange={(event) => setScopeValue(event.target.value)}
              className="form-control"
            >
              {isWideRole ? (
                <option value="organization">All organization branches</option>
              ) : null}
              {allowedBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="min-h-11 rounded-md bg-foreground px-4 text-sm font-medium text-background form-action"
            type="submit"
          >
            Apply period
          </button>
          <p className="text-xs text-muted-foreground">
            Dates use the organization reporting timezone. Weeks begin Monday.
            Maximum span: 366 local dates.
          </p>
        </div>
      </form>
      <nav aria-label="Analytics views" className="flex flex-wrap gap-2">
        {(organization.role === "INVENTORY_STAFF"
          ? (["inventory", "forecast-reorder"] as const)
          : ([
              "sales",
              "categories",
              "branches",
              "inventory",
              "forecast-reorder",
              "insights",
            ] as const)
        ).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
            className={`min-h-11 rounded-md px-4 text-sm font-medium ${view === item ? "bg-foreground text-background" : "border bg-card"}`}
          >
            {item === "sales"
              ? "Sales"
              : item === "categories"
                ? "Categories"
                : item === "branches"
                  ? "Branches"
                  : item === "inventory"
                    ? "Inventory"
                    : item === "insights"
                      ? "AI insights"
                      : "Forecast / Reorder"}
          </button>
        ))}
      </nav>
      {view === "insights" ? (
        <AiInsightView
          key={selectedBranchId ?? ""}
          organization={organization}
          selectedBranchId={selectedBranchId}
        />
      ) : view === "forecast-reorder" ? (
        <ForecastReorderView organization={organization} />
      ) : view === "inventory" ? (
        <InventoryAnalyticsView
          request={request}
          enabled={enabled}
          role={organization.role}
        />
      ) : !enabled ? (
        <p className="form-message" role="alert">
          Choose an accessible branch and a valid date range.
        </p>
      ) : salesQuery.isPending ? (
        <p aria-live="polite">Loading sales analytics…</p>
      ) : salesQuery.isError ? (
        <p className="form-message" role="alert">
          {errorMessage(salesQuery.error)}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <p>
              Reporting timezone: {salesQuery.data.meta.reportingTimezone} ·{" "}
              {salesQuery.data.meta.dataStatus} ·{" "}
              {salesQuery.data.meta.includedBranchCount} branches
            </p>
            <p>Data as of {salesQuery.data.meta.sourceCutoff}</p>
          </div>
          {buckets.length > 0 ? (
            <label className="form-field max-w-xs">
              Selected period
              <select
                value={activeBucket?.localStartInclusive ?? ""}
                onChange={(event) => setSelectedBucket(event.target.value)}
                className="form-control"
              >
                {buckets.map((bucket) => (
                  <option
                    value={bucket.localStartInclusive}
                    key={bucket.localStartInclusive}
                  >
                    {bucket.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {view === "sales" ? (
            <section className="space-y-5" aria-label="Sales analytics">
              {buckets.length === 0 ? (
                <p>No sales periods were returned.</p>
              ) : (
                <>
                  {activeBucket && <SalesMetrics bucket={activeBucket} />}
                  {buckets.every(
                    (bucket) =>
                      bucket.saleCount === 0 && bucket.refundCount === 0,
                  ) ? (
                    <p className="rounded-lg border bg-card p-4 text-sm">
                      No sales or refunds in this period.
                    </p>
                  ) : null}
                  <NetSalesChart buckets={buckets} />
                  <SalesSeriesTable buckets={buckets} />
                </>
              )}
            </section>
          ) : null}
          {view === "categories" ? (
            <section className="space-y-4" aria-label="Category analytics">
              <h2 className="text-xl font-semibold">Categories</h2>
              {categoryQuery.isPending ? (
                <p aria-live="polite">Loading categories…</p>
              ) : categoryQuery.isError ? (
                <div role="alert">
                  <p>{errorMessage(categoryQuery.error)}</p>
                  {categoryQuery.error instanceof AnalyticsApiError &&
                  categoryQuery.error.kind === "invalid_cursor" ? (
                    <button
                      type="button"
                      onClick={() => setCategoryReset((value) => value + 1)}
                      className="underline"
                    >
                      Restart category list
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {categoryQuery.data.pages.flatMap(
                    (page) => page.data.categories,
                  ).length === 0 ? (
                    <p>No categories in this scope.</p>
                  ) : (
                    <div className="space-y-3">
                      {categoryQuery.data.pages
                        .flatMap((page) => page.data.categories)
                        .map((category) => {
                          const bucket = category.buckets[activeIndex];
                          return (
                            <details
                              key={category.categoryId ?? "uncategorized"}
                              className="rounded-lg border bg-card p-4"
                            >
                              <summary className="cursor-pointer">
                                <span className="font-medium break-words">
                                  {category.categoryKind === "UNCATEGORIZED"
                                    ? "Uncategorized"
                                    : category.categoryName}
                                </span>
                                {category.categoryStatus === "INACTIVE" ? (
                                  <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">
                                    Inactive
                                  </span>
                                ) : null}
                                <span className="ml-3 text-sm text-muted-foreground">
                                  {bucket
                                    ? `${money(bucket.netSalesAmount)} net sales · ${nullable(bucket.categorySharePercent, "percent")} share`
                                    : "No period data"}
                                </span>
                              </summary>
                              <CategorySeriesTable buckets={category.buckets} />
                            </details>
                          );
                        })}
                    </div>
                  )}
                  {categoryQuery.hasNextPage ? (
                    <button
                      disabled={categoryQuery.isFetchingNextPage}
                      type="button"
                      onClick={() => void categoryQuery.fetchNextPage()}
                      className="min-h-11 rounded-md border bg-card px-4 text-sm font-medium disabled:opacity-60 form-action"
                    >
                      {categoryQuery.isFetchingNextPage
                        ? "Loading next page…"
                        : "Load more categories"}
                    </button>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
          {view === "branches" ? (
            <section className="space-y-4" aria-label="Branch analytics">
              <h2 className="text-xl font-semibold">Branches</h2>
              {branchQuery.isPending ? (
                <p aria-live="polite">Loading branches…</p>
              ) : branchQuery.isError ? (
                <div role="alert">
                  <p>{errorMessage(branchQuery.error)}</p>
                  {branchQuery.error instanceof AnalyticsApiError &&
                  branchQuery.error.kind === "invalid_cursor" ? (
                    <button
                      type="button"
                      onClick={() => setBranchReset((value) => value + 1)}
                      className="underline"
                    >
                      Restart branch list
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {branchQuery.data.pages.flatMap((page) => page.data.branches)
                    .length === 0 ? (
                    <p>No branches in this scope.</p>
                  ) : (
                    <div className="space-y-3">
                      {branchQuery.data.pages
                        .flatMap((page) => page.data.branches)
                        .map((branch) => {
                          const bucket = branch.buckets[activeIndex];
                          return (
                            <details
                              key={branch.branchId}
                              className="rounded-lg border bg-card p-4"
                            >
                              <summary className="cursor-pointer">
                                <span className="font-medium break-words">
                                  {branch.branchName}
                                </span>
                                {branch.branchStatus === "INACTIVE" ? (
                                  <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">
                                    Inactive
                                  </span>
                                ) : null}
                                <span className="ml-3 text-sm text-muted-foreground">
                                  {bucket
                                    ? `${money(bucket.netSalesAmount)} net sales · ${bucket.saleCount} sales`
                                    : "No period data"}
                                </span>
                              </summary>
                              <div className="mt-4 space-y-4">
                                {bucket ? (
                                  <SalesMetrics bucket={bucket} />
                                ) : null}
                                <SalesSeriesTable buckets={branch.buckets} />
                              </div>
                            </details>
                          );
                        })}
                    </div>
                  )}
                  {branchQuery.hasNextPage ? (
                    <button
                      disabled={branchQuery.isFetchingNextPage}
                      type="button"
                      onClick={() => void branchQuery.fetchNextPage()}
                      className="min-h-11 rounded-md border bg-card px-4 text-sm font-medium disabled:opacity-60 form-action"
                    >
                      {branchQuery.isFetchingNextPage
                        ? "Loading next page…"
                        : "Load more branches"}
                    </button>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </>
      )}
    </PageFrame>
  );
}
