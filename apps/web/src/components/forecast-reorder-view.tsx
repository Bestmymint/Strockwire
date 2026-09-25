"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  AnalyticsApiError,
  getAnalyticsForecast,
  getAnalyticsReorder,
} from "@/analytics-api-client";
import type { AccessibleOrganization } from "@/branch-api-client";
import { listProducts } from "@/catalog-api-client";

const reasons: Record<string, string> = {
  INACTIVE_PRODUCT: "This Product is inactive. Estimates are unavailable.",
  INSUFFICIENT_DATA:
    "No inventory movement for this Branch/Product is recorded at or before the 28-day training window began.",
  LEAD_TIME_REQUIRED:
    "Choose a planning lead time to see a reorder recommendation.",
  UNSUPPORTED_LEAD_TIME:
    "Planning lead time must be a whole number from 1 to 7 days.",
  INVENTORY_INTEGRITY_ERROR:
    "Inventory balance or ledger integrity needs review before recommending a quantity.",
  QUANTITY_OUT_OF_RANGE: "The calculated quantity exceeds the supported range.",
};

function requestError(error: unknown): string {
  if (error instanceof AnalyticsApiError) {
    if (error.kind === "forbidden")
      return "Forecast and reorder are not available for your current access.";
    if (error.kind === "authentication_required")
      return "Sign in again to view forecast and reorder.";
    if (error.kind === "configuration")
      return "Analytics reporting time needs configuration.";
    if (error.kind === "validation")
      return "Check the selected Branch and Product.";
  }
  return "Forecast and reorder could not be loaded. Try again.";
}

export function ForecastReorderView({
  organization,
}: {
  organization: AccessibleOrganization;
}) {
  const [branchId, setBranchId] = useState(organization.branches[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState<number | null>(null);
  const activeBranch = organization.branches.find(
    (branch) => branch.id === branchId,
  );
  const scopeKey = [
    "forecast-reorder",
    organization.id,
    organization.role,
    organization.branches.map((branch) => branch.id).join(","),
    activeBranch?.id ?? null,
  ] as const;
  const products = useInfiniteQuery({
    queryKey: [...scopeKey, "products", search],
    queryFn: ({ pageParam }) =>
      listProducts(
        {
          organizationId: organization.id,
          ...(activeBranch ? { branchId: activeBranch.id } : {}),
        },
        {
          includeInactive: true,
          q: search,
          limit: 100,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.meta.nextCursor ?? undefined,
    enabled: activeBranch !== undefined,
  });
  const options =
    products.data?.pages.flatMap((page) => page.data.products) ?? [];
  const chosenProduct = options.find((product) => product.id === productId);
  const pair = {
    organizationId: organization.id,
    branchId: activeBranch?.id ?? "",
    productId,
  };
  const enabled = activeBranch !== undefined && chosenProduct !== undefined;
  const forecast = useQuery({
    queryKey: [...scopeKey, productId, "forecast"],
    queryFn: ({ signal }) => getAnalyticsForecast(pair, signal),
    enabled,
  });
  const reorder = useQuery({
    queryKey: [...scopeKey, productId, leadTimeDays, "reorder"],
    queryFn: ({ signal }) =>
      getAnalyticsReorder({ ...pair, leadTimeDays }, signal),
    enabled,
  });
  const forecastResult = forecast.data?.data.forecast;
  const reorderResult = reorder.data?.data.recommendation;

  return (
    <section aria-label="Forecast and reorder" className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Forecast and reorder</h2>
        <p className="text-sm text-muted-foreground">
          One Branch and Product. Forecast dates and training window are fixed
          by the organization reporting timezone.
        </p>
      </div>
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Branch
          <select
            value={activeBranch?.id ?? ""}
            onChange={(event) => {
              setBranchId(event.target.value);
              setProductId("");
            }}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
          >
            {organization.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <label className="block text-sm font-medium">
            Find Product
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setProductId("");
              }}
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
            />
          </label>
          <label className="block text-sm font-medium">
            Product
            <select
              value={chosenProduct?.id ?? ""}
              onChange={(event) => setProductId(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
            >
              <option value="">Choose a Product</option>
              {options.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} — {product.name}
                  {product.status === "INACTIVE" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          {products.isPending && activeBranch ? (
            <p aria-live="polite" className="text-sm">
              Loading Products…
            </p>
          ) : null}
          {products.isError ? (
            <p role="alert" className="text-sm">
              Products could not be loaded.
            </p>
          ) : null}
          {products.isSuccess && options.length === 0 ? (
            <p className="text-sm">No Products match this search.</p>
          ) : null}
          {products.hasNextPage ? (
            <button
              type="button"
              onClick={() => void products.fetchNextPage()}
              disabled={products.isFetchingNextPage}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {products.isFetchingNextPage ? "Loading…" : "Load more Products"}
            </button>
          ) : null}
        </div>
        <label className="text-sm font-medium">
          Planning lead time
          <select
            value={leadTimeDays ?? ""}
            onChange={(event) =>
              setLeadTimeDays(
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="">Choose 1–7 days</option>
            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
              <option key={days} value={days}>
                {days} {days === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!activeBranch ? (
        <p role="alert">No accessible active Branch is available.</p>
      ) : !chosenProduct ? (
        <p>Choose a Product to see its forecast and reorder status.</p>
      ) : (
        <>
          <section
            aria-label="Forecast result"
            className="space-y-3 rounded-lg border bg-card p-4"
          >
            <h3 className="font-semibold">Seven-day forecast</h3>
            {forecast.isPending ? (
              <p aria-live="polite">Loading forecast…</p>
            ) : forecast.isError ? (
              <p role="alert">{requestError(forecast.error)}</p>
            ) : forecastResult ? (
              <>
                <p className="text-sm">
                  Version: {forecastResult.forecastVersion} · Status:{" "}
                  {forecastResult.status}
                </p>
                <p className="text-sm">
                  Reporting timezone: {forecastResult.reportingTimezone} · Data
                  as of {forecastResult.sourceCutoff}
                </p>
                <p className="text-sm">
                  Training: {forecastResult.trainingStartInclusive} to{" "}
                  {forecastResult.trainingEndExclusive} · Horizon:{" "}
                  {forecastResult.horizonStartInclusive} to{" "}
                  {forecastResult.horizonEndExclusive}
                </p>
                {forecastResult.status === "UNAVAILABLE" ? (
                  <p role="status">{reasons[forecastResult.reason ?? ""]}</p>
                ) : (
                  <>
                    <p className="text-2xl font-semibold tabular-nums">
                      {forecastResult.horizonTotal} {forecastResult.unit} total
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <caption className="py-2 text-left font-medium">
                          Daily forecast in {forecastResult.unit}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col" className="py-2">
                              Local date
                            </th>
                            <th scope="col">Quantity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {forecastResult.days.map((day) => (
                            <tr key={day.localDate} className="border-t">
                              <th scope="row" className="py-2 font-normal">
                                {day.localDate}
                              </th>
                              <td className="tabular-nums">
                                {day.quantity} {forecastResult.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </section>
          <section
            aria-label="Reorder result"
            className="space-y-3 rounded-lg border bg-card p-4"
          >
            <h3 className="font-semibold">Advisory reorder recommendation</h3>
            {reorder.isPending ? (
              <p aria-live="polite">Loading reorder recommendation…</p>
            ) : reorder.isError ? (
              <p role="alert">{requestError(reorder.error)}</p>
            ) : reorderResult ? (
              <>
                <p className="text-sm">
                  Version: {reorderResult.reorderVersion} · Forecast:{" "}
                  {reorderResult.forecastVersion} · Status:{" "}
                  {reorderResult.status}
                </p>
                <p className="text-sm">
                  Data as of {reorderResult.sourceCutoff}
                </p>
                {reorderResult.status === "UNAVAILABLE" ? (
                  <p role="status">{reasons[reorderResult.reason ?? ""]}</p>
                ) : (
                  <>
                    <p className="text-2xl font-semibold tabular-nums">
                      Recommend {reorderResult.recommendedQuantity}{" "}
                      {reorderResult.unit}
                    </p>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt>Planning lead time</dt>
                        <dd>{reorderResult.leadTimeDays} days</dd>
                      </div>
                      <div>
                        <dt>Forecast demand</dt>
                        <dd>
                          {reorderResult.leadTimeDemand} {reorderResult.unit}
                        </dd>
                      </div>
                      <div>
                        <dt>On hand</dt>
                        <dd>
                          {reorderResult.onHand} {reorderResult.unit}
                        </dd>
                      </div>
                      <div>
                        <dt>Need before unit rounding</dt>
                        <dd>
                          {reorderResult.rawNeed} {reorderResult.unit}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
              </>
            ) : null}
          </section>
        </>
      )}
      <section
        className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm"
        aria-label="Forecast and reorder limitations"
      >
        <h3 className="font-semibold">How to interpret these estimates</h3>
        <p>
          Forecast uses a simple mean of observed completed-sale quantities over
          28 complete local days. Zero days remain zero. It has no seasonality
          or lost-demand correction; stockouts may suppress observed demand. The
          current partial local day is excluded.
        </p>
        <p>
          Reorder uses your selected lead time of at most seven days. Safety
          stock is zero and pending incoming orders are excluded. It has no
          Supplier, MOQ, or purchase-pack logic. This is advisory only and never
          places an order.
        </p>
      </section>
    </section>
  );
}
