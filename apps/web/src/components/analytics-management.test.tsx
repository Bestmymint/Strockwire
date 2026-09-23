// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsManagement } from "./analytics-management";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(`organizationId=${ORG}&branchId=${BRANCH}`),
}));
vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ data }: { data: unknown }) => (
    <div data-testid="trend-data">{JSON.stringify(data)}</div>
  ),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const OTHER_BRANCH = "20000000-0000-4000-8000-000000000002";
let requests: string[];
let role: string;
let salesCost: boolean;
let categoryCursorError: boolean;
let salesError: { code: string; status: number } | null;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function bucket(label: string, netSalesAmount: string) {
  return {
    averageOrderValue: { reason: "NO_SALES", value: null },
    dataStatus: "complete",
    discountAmount: "2.00",
    grossSalesAmount: "10.00",
    label,
    localEndExclusive: label === "2026-09-22" ? "2026-09-23" : "2026-09-24",
    localStartInclusive: label,
    netOutputVatAmount: "0.00",
    netSalesAmount,
    netSalesGrowthPercent: { reason: "NO_BASELINE", value: null },
    outputVatAmount: "0.00",
    refundAmount: "12.00",
    refundCount: 1,
    refundedDiscountAmount: "0.00",
    refundedOutputVatAmount: "0.00",
    refundedRegisteredTaxableAmount: {
      reason: "NO_REGISTERED_REFUNDS",
      value: null,
    },
    refundedSaleCount: 1,
    registeredTaxableSalesAmount: {
      reason: "NO_REGISTERED_SALES",
      value: null,
    },
    saleCount: 0,
    salesAfterDiscountAmount: "8.00",
    ...(salesCost
      ? {
          cost: {
            costCoverage: "partial",
            grossMarginPercent: {
              reason: "INCOMPLETE_COST_COVERAGE",
              value: null,
            },
            grossProfitAmount: {
              reason: "INCOMPLETE_COST_COVERAGE",
              value: null,
            },
            knownCostLineCount: 1,
            knownNetCogsAmount: "2.0000000000",
            netCogsAmount: { reason: "INCOMPLETE_COST_COVERAGE", value: null },
            refundCogsReversalAmount: "0.0000000000",
            saleCogsAmount: "2.0000000000",
            unknownCostLineCount: 1,
          },
        }
      : {}),
  };
}

function meta(nextCursor: string | null = null) {
  return {
    dataStatus: "complete",
    granularity: "day",
    includedBranchCount: 2,
    localFromInclusive: "2026-09-22",
    localToExclusive: "2026-09-24",
    reportingTimezone: "Asia/Bangkok",
    scopeType: "organization",
    sourceCutoff: "2026-09-23T00:00:00.000Z",
    nextCursor,
  };
}

function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  requests.push(url);
  if (url.endsWith("me/access-context"))
    return Promise.resolve(
      json({
        data: {
          firstOrganizationOnboarding: { eligible: false },
          organizations: [
            {
              id: ORG,
              name: "Store One",
              role,
              branches: [
                { id: BRANCH, code: "A", name: "Alpha" },
                { id: OTHER_BRANCH, code: "B", name: "Beta" },
              ],
            },
          ],
          user: {
            id: "30000000-0000-4000-8000-000000000001",
            email: "owner@example.com",
            displayName: "Owner",
          },
        },
      }),
    );
  if (url.includes("/analytics/sales?") && salesError)
    return Promise.resolve(
      json({ error: { code: salesError.code } }, salesError.status),
    );
  if (url.includes("/analytics/sales?"))
    return Promise.resolve(
      json({
        data: {
          buckets: [
            bucket("2026-09-22", "0.00"),
            bucket("2026-09-23", "-4.00"),
          ],
        },
        meta: meta(),
      }),
    );
  if (url.includes("/analytics/categories?")) {
    const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
    if (cursor && categoryCursorError)
      return Promise.resolve(json({ error: { code: "INVALID_CURSOR" } }, 400));
    return Promise.resolve(
      json({
        data: {
          categories: [
            {
              categoryId: cursor
                ? "40000000-0000-4000-8000-000000000002"
                : null,
              categoryKind: cursor ? "CATEGORY" : "UNCATEGORIZED",
              categoryName: cursor ? "Old category" : "UNCATEGORIZED",
              categoryStatus: cursor ? "INACTIVE" : null,
              buckets: [
                bucket("2026-09-22", "0.00"),
                bucket("2026-09-23", "-4.00"),
              ].map((row) => ({
                dataStatus: row.dataStatus,
                discountAmount: row.discountAmount,
                grossSalesAmount: row.grossSalesAmount,
                label: row.label,
                localEndExclusive: row.localEndExclusive,
                localStartInclusive: row.localStartInclusive,
                netSalesAmount: row.netSalesAmount,
                refundAmount: row.refundAmount,
                salesAfterDiscountAmount: row.salesAfterDiscountAmount,
                categorySharePercent: { reason: "NO_SALES", value: null },
              })),
            },
          ],
        },
        meta: meta(cursor ? null : "opaque-category-next"),
      }),
    );
  }
  if (url.includes("/analytics/branches?")) {
    const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
    return Promise.resolve(
      json({
        data: {
          branches: [
            {
              branchId: cursor ? OTHER_BRANCH : BRANCH,
              branchName: cursor ? "Old Branch" : "Zero Branch",
              branchStatus: cursor ? "INACTIVE" : "ACTIVE",
              buckets: [
                bucket("2026-09-22", "0.00"),
                bucket("2026-09-23", cursor ? "-4.00" : "0.00"),
              ],
            },
          ],
        },
        meta: meta(cursor ? null : "opaque-branch-next"),
      }),
    );
  }
  throw new Error(`Unexpected request: ${url}`);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AnalyticsManagement />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests = [];
  role = "OWNER";
  salesCost = false;
  categoryCursorError = false;
  salesError = null;
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("analytics management", () => {
  it("renders exact API sales strings, null reasons, negative trend, and hides absent cost", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Analytics" }),
    ).toBeTruthy();
    expect(
      await screen.findByText("THB -4.00", { selector: "dd" }),
    ).toBeTruthy();
    expect(screen.getByText("No sales", { selector: "dd" })).toBeTruthy();
    expect(
      screen.getByText("No comparison baseline", { selector: "dd" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Cost and profit" }),
    ).toBeNull();
    expect(screen.getByTestId("trend-data").textContent).toContain(
      '"netSales":-4',
    );
    expect(
      screen.getByTestId("trend-data").textContent?.indexOf("2026-09-22"),
    ).toBeLessThan(
      screen.getByTestId("trend-data").textContent?.indexOf("2026-09-23") ?? 0,
    );
  });

  it("uses explicit period and authorized branch scope inputs", async () => {
    renderPage();
    await screen.findByText("THB -4.00", { selector: "dd" });
    fireEvent.change(screen.getByLabelText("Analytics scope"), {
      target: { value: BRANCH },
    });
    await waitFor(() =>
      expect(
        requests.some((url) => url.includes(`scope=branch&branchId=${BRANCH}`)),
      ).toBe(true),
    );
    fireEvent.change(screen.getByLabelText("From (inclusive)"), {
      target: { value: "2026-09-22" },
    });
    fireEvent.change(screen.getByLabelText("To (exclusive)"), {
      target: { value: "2026-09-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
    await waitFor(() =>
      expect(
        requests.some((url) =>
          url.includes("from=2026-09-22&to=2026-09-24&granularity=day"),
        ),
      ).toBe(true),
    );
  });

  it("paginates both dimensions with opaque cursors and restarts on period changes", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Categories" }));
    expect(
      screen
        .getByRole("button", { name: "Categories" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(await screen.findByText("Uncategorized")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more categories" }),
    );
    expect(await screen.findByText("Old category")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(
      requests.some((url) => url.includes("cursor=opaque-category-next")),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("From (inclusive)"), {
      target: { value: "2026-09-22" },
    });
    fireEvent.change(screen.getByLabelText("To (exclusive)"), {
      target: { value: "2026-09-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
    await waitFor(() =>
      expect(
        requests.some(
          (url) =>
            url.includes("/analytics/categories?") &&
            url.includes("from=2026-09-22&to=2026-09-24") &&
            !url.includes("cursor="),
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("Old category")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(await screen.findByText("Zero Branch")).toBeTruthy();
    expect(screen.getByText(/THB 0.00 net sales · 0 sales/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more branches" }));
    expect(await screen.findByText("Old Branch")).toBeTruthy();
    expect(
      requests.some((url) => url.includes("cursor=opaque-branch-next")),
    ).toBe(true);
    expect(screen.queryByText(/Top|Rank/i)).toBeNull();
  });

  it("denies cashier locally and shows backend errors without metrics", async () => {
    role = "CASHIER";
    renderPage();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Analytics is not available for your current access.",
    );
    expect(requests.some((url) => url.includes("/analytics/"))).toBe(false);
  });

  it("shows cost coverage and incomplete-cost reasons only when API supplies cost", async () => {
    salesCost = true;
    renderPage();
    expect(
      await screen.findByRole("region", { name: "Cost and profit" }),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Cost and profit" }),
      ).getAllByText("Cost coverage is incomplete"),
    ).toHaveLength(3);
    fireEvent.click(screen.getByText("Cost detail"));
    expect(screen.getByText("Known cost lines")).toBeTruthy();
    expect(screen.getByText("Unknown cost lines")).toBeTruthy();
  });

  it("handles an authoritative API denial without showing financial data", async () => {
    salesError = { code: "FORBIDDEN", status: 403 };
    renderPage();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Analytics is not available for your current access.",
    );
    expect(screen.queryByText("THB -4.00")).toBeNull();
  });

  it("prompts for sign-in when the analytics session expires", async () => {
    salesError = { code: "AUTHENTICATION_REQUIRED", status: 401 };
    renderPage();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Sign in again to view analytics.",
    );
    expect(screen.queryByText("THB -4.00")).toBeNull();
  });

  it("restarts a dimension list after an invalid cursor", async () => {
    categoryCursorError = true;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Categories" }));
    await screen.findByText("Uncategorized");
    fireEvent.click(
      screen.getByRole("button", { name: "Load more categories" }),
    );
    expect(
      await screen.findByText(
        "This page can no longer be continued. Restart this list.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Restart category list" }),
    );
    expect(await screen.findByText("Uncategorized")).toBeTruthy();
  });
});
