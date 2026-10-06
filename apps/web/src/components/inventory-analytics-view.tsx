"use client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  AnalyticsApiError,
  getAnalyticsInventory,
  type AnalyticsInventoryResponse,
  type AnalyticsRequest,
} from "@/analytics-api-client";

import { formatMoney } from "@/money-display";

const reasons: Record<string, string> = {
  INCOMPLETE_PERIOD: "The selected period is not complete",
  INSUFFICIENT_DATA: "Fewer than 28 complete days of inventory history",
  NO_RECENT_DEMAND: "No sales depletion in the recent 28 complete days",
  NO_STOCK_AND_NO_DEMAND: "No stock and no recent sales depletion",
  INVENTORY_INTEGRITY_ERROR: "Inventory balance or cost state needs review",
  INACTIVE_PRODUCT: "Product is inactive",
  INCOMPLETE_COST_COVERAGE: "Some stocked products have unknown cost",
};

function metric(
  metric: { value: string | null; reason: string | null },
  unit = "",
) {
  return metric.value === null
    ? (reasons[metric.reason ?? ""] ?? "Unavailable")
    : `${metric.value}${unit}`;
}

function costDetail(
  cost: NonNullable<
    AnalyticsInventoryResponse["data"]["branches"][number]["cost"]
  >,
) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt>Current inventory value</dt>
        <dd>
          {cost.inventoryValue.value === null
            ? metric(cost.inventoryValue)
            : `${formatMoney(cost.inventoryValue.value)} THB`}
        </dd>
      </div>
      <div>
        <dt>Known inventory value</dt>
        <dd>{formatMoney(cost.knownInventoryValue)} THB</dd>
      </div>
      <div>
        <dt>Products with known cost</dt>
        <dd>{cost.knownCostProductCount}</dd>
      </div>
      <div>
        <dt>Products with unknown cost</dt>
        <dd>{cost.unknownCostProductCount}</dd>
      </div>
      <div>
        <dt>Unknown cost quantity by unit</dt>
        <dd>
          {Object.entries(cost.unknownQuantityByUnit)
            .map(([unit, quantity]) => `${quantity} ${unit}`)
            .join(", ") || "None"}
        </dd>
      </div>
    </dl>
  );
}

function errorText(error: unknown) {
  if (error instanceof AnalyticsApiError) {
    if (error.kind === "invalid_cursor")
      return "The inventory page can no longer be continued. Restart the list.";
    if (error.kind === "forbidden")
      return "Inventory analytics is not available for your current access.";
    if (error.kind === "validation")
      return "Check the period and scope, then try again.";
    if (error.kind === "authentication_required")
      return "Sign in again to view inventory analytics.";
    if (error.kind === "configuration")
      return "Analytics reporting time needs configuration.";
  }
  return "Inventory analytics could not be loaded. Try again.";
}

export function InventoryAnalyticsView({
  request,
  enabled,
  role,
}: {
  request: AnalyticsRequest;
  enabled: boolean;
  role: string;
}) {
  const [reset, setReset] = useState(0);
  const query = useInfiniteQuery({
    queryKey: [
      "analytics",
      request.organizationId,
      role,
      request.scope,
      request.scope === "branch" ? request.branchId : null,
      request.from,
      request.to,
      request.granularity,
      "inventory",
      reset,
    ],
    queryFn: ({ signal, pageParam }) =>
      getAnalyticsInventory(request, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.meta.nextCursor ?? undefined,
    enabled,
  });
  if (!enabled)
    return (
      <p role="alert">Choose an accessible branch and a valid date range.</p>
    );
  if (query.isPending)
    return <p aria-live="polite">Loading inventory analytics…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>{errorText(query.error)}</p>
        {query.error instanceof AnalyticsApiError &&
        query.error.kind === "invalid_cursor" ? (
          <Button
            variant="outline"
            type="button"
            className="underline"
            onClick={() => setReset((value) => value + 1)}
          >
            Restart inventory list
          </Button>
        ) : null}
      </div>
    );

  const pages = query.data.pages;
  const latest = pages.at(-1)!;
  const dimensions = pages.flatMap((page) => page.data.dimensions);
  const noMovements =
    dimensions.length > 0 &&
    dimensions.every((row) =>
      row.buckets.every((bucket) =>
        [
          bucket.purchaseReceivedQuantity,
          bucket.saleDepletionQuantity,
          bucket.refundReturnQuantity,
          bucket.positiveAdjustmentQuantity,
          bucket.negativeAdjustmentQuantity,
        ].every((value) => /^0(?:\.0+)?$/.test(value)),
      ),
    );
  return (
    <section aria-label="Inventory analytics" className="space-y-5">
      <h2 className="text-xl font-semibold">Inventory</h2>
      <p className="text-sm text-muted-foreground">
        Reporting timezone: {latest.meta.reportingTimezone} ·{" "}
        {latest.meta.dataStatus} · {latest.meta.includedBranchCount} branches
        <br />
        Movement facts through {latest.meta.sourceCutoff}; current stock is
        captured separately for each page.
      </p>
      <section aria-label="Current branch availability" className="space-y-3">
        <h3 className="text-lg font-semibold">Current branch availability</h3>
        <p className="text-xs text-muted-foreground">
          Current snapshot captured {latest.meta.currentSnapshotCapturedAt}
        </p>
        {latest.data.branches.length === 0 ? (
          <p>No branches in this scope.</p>
        ) : (
          latest.data.branches.map((branch) => (
            <div
              key={branch.branchId}
              className="rounded-lg border bg-card p-4"
            >
              <h4 className="font-medium">
                {branch.branchName}
                {branch.branchStatus === "INACTIVE" ? " (inactive)" : ""}
              </h4>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt>Active products</dt>
                  <dd>{branch.activeProductCount}</dd>
                </div>
                <div>
                  <dt>In stock</dt>
                  <dd>{branch.inStockProductCount}</dd>
                </div>
                <div>
                  <dt>Out of stock</dt>
                  <dd>{branch.outOfStockProductCount}</dd>
                </div>
              </dl>
              {branch.cost ? (
                <div className="mt-3 border-t pt-3">
                  {costDetail(branch.cost)}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Cost and value require additional access.
                </p>
              )}
            </div>
          ))
        )}
      </section>
      <section aria-label="Product movement and coverage" className="space-y-3">
        <h3 className="text-lg font-semibold">Product movement and coverage</h3>
        {dimensions.length === 0 ? (
          <p>No product dimensions in this scope.</p>
        ) : null}
        {noMovements && !query.hasNextPage ? (
          <p>
            No movements in the selected period. Current stock is still shown.
          </p>
        ) : null}
        {pages.map((page, pageIndex) => (
          <div key={pageIndex} className="space-y-3">
            {page.data.dimensions.map((row) => (
              <details
                key={`${row.branchId}/${row.productId}`}
                className="rounded-lg border bg-card p-4"
              >
                <summary className="cursor-pointer font-medium">
                  {row.productName} · {row.branchName} · {row.onHandQuantity}{" "}
                  {row.productUnit} on hand
                  {row.productStatus === "INACTIVE"
                    ? " · Inactive product"
                    : ""}
                  {" · "}
                  {row.stockClassification.classification?.replace("_", " ") ??
                    "Classification unavailable"}
                </summary>
                <div className="mt-3 space-y-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Current snapshot captured{" "}
                    {page.meta.currentSnapshotCapturedAt}
                  </p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <dt>Requested-period average daily sales</dt>
                      <dd>
                        {metric(
                          row.requestedPeriodAds,
                          ` ${row.productUnit}/day`,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>28-day sales velocity</dt>
                      <dd>
                        {metric(
                          row.coverageSalesVelocity,
                          ` ${row.productUnit}/day`,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Current coverage</dt>
                      <dd>{metric(row.coverageDays, " days")}</dd>
                    </div>
                    <div>
                      <dt>
                        Stock classification (
                        {row.stockClassification.thresholdVersion})
                      </dt>
                      <dd>
                        {row.stockClassification.classification?.replace(
                          "_",
                          " ",
                        ) ??
                          reasons[row.stockClassification.reason ?? ""] ??
                          "Unavailable"}
                      </dd>
                    </div>
                  </dl>
                  {row.cost ? (
                    <section
                      aria-label="Product inventory value"
                      className="border-t pt-3"
                    >
                      {costDetail(row.cost)}
                    </section>
                  ) : null}
                  <div className="overflow-x-auto">
                    <Table className="w-full min-w-[700px] text-left text-sm">
                      <caption className="py-2 text-left font-medium">
                        Movement by period for {row.productName} (
                        {row.productUnit})
                      </caption>
                      <TableHeader>
                        <TableRow className="border-b">
                          <TableHead scope="col">Period</TableHead>
                          <TableHead scope="col">Received</TableHead>
                          <TableHead scope="col">Sales depletion</TableHead>
                          <TableHead scope="col">Refund returns</TableHead>
                          <TableHead scope="col">
                            Positive adjustments
                          </TableHead>
                          <TableHead scope="col">
                            Negative adjustments
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {row.buckets.map((bucket) => (
                          <TableRow
                            key={bucket.localStartInclusive}
                            className="border-b last:border-0"
                          >
                            <TableHead scope="row" className="py-2">
                              {bucket.label}
                            </TableHead>
                            <TableCell>
                              {bucket.purchaseReceivedQuantity}
                            </TableCell>
                            <TableCell>
                              {bucket.saleDepletionQuantity}
                            </TableCell>
                            <TableCell>{bucket.refundReturnQuantity}</TableCell>
                            <TableCell>
                              {bucket.positiveAdjustmentQuantity}
                            </TableCell>
                            <TableCell>
                              {bucket.negativeAdjustmentQuantity}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        ))}
        {query.hasNextPage ? (
          <Button
            variant="outline"
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="bg-card"
          >
            {query.isFetchingNextPage
              ? "Loading next page…"
              : "Load more inventory"}
          </Button>
        ) : null}
      </section>
    </section>
  );
}
