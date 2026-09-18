// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAccessContext } from "@/branch-api-client";
import {
  getSalesHistoryDetail,
  listSalesHistory,
  SalesApiError,
  type SalesHistoryDetail,
} from "@/sales-api-client";

import { SalesHistoryManagement } from "./sales-history-management";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const SALE_ID = "30000000-0000-4000-8000-000000000001";
const CASHIER_ID = "40000000-0000-4000-8000-000000000001";
let role: "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER" =
  "OWNER";
let currentSearchParams = new URLSearchParams({
  branchId: BRANCH_ID,
  organizationId: ORGANIZATION_ID,
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}));
vi.mock("@/branch-api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/branch-api-client")>();
  return { ...original, fetchAccessContext: vi.fn() };
});
vi.mock("@/sales-api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/sales-api-client")>();
  return {
    ...original,
    getSalesHistoryDetail: vi.fn(),
    listSalesHistory: vi.fn(),
  };
});

const summary = {
  actorDisplayName: "Historical cashier",
  createdAt: "2026-09-18T10:00:00.000Z",
  currency: "THB" as const,
  discount: null,
  discountAmount: "0.00",
  id: SALE_ID,
  itemCount: 1,
  outputVatAmount: "0.00",
  payment: {
    amount: "12.34",
    amountTendered: "20.00",
    changeAmount: "7.66",
    method: "CASH" as const,
    reference: null,
  },
  reference: "SALE-IMMUTABLE-001",
  salesVatRate: null,
  salesVatStatus: "NOT_REGISTERED" as const,
  subtotalAmount: "12.34",
  taxableAmount: null,
  totalAmount: "12.34",
};
const detail: SalesHistoryDetail = {
  ...summary,
  branchCode: "MAIN",
  branchName: "Main",
  items: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      lineDiscount: "0.00",
      lineGross: "12.34",
      lineNet: "12.34",
      lineOutputVat: "0.00",
      lineTaxable: null,
      productId: "60000000-0000-4000-8000-000000000001",
      productName: "Historical coffee",
      productSku: "COFFEE-OLD",
      quantity: "1.0000",
      unit: "EA",
      unitPrice: "12.3400",
    },
  ],
  organizationName: "Store",
};

function renderSales() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SalesHistoryManagement />
    </QueryClientProvider>,
  );
  return queryClient;
}

function mockAccess(roleValue: typeof role) {
  vi.mocked(fetchAccessContext).mockResolvedValue({
    firstOrganizationOnboarding: { eligible: false },
    organizations: [
      {
        branches: [{ code: "MAIN", id: BRANCH_ID, name: "Main" }],
        id: ORGANIZATION_ID,
        name: "Store",
        role: roleValue,
      },
    ],
    user: { displayName: "Owner", email: "owner@example.test", id: CASHIER_ID },
  });
}

beforeEach(() => {
  role = "OWNER";
  currentSearchParams = new URLSearchParams({
    branchId: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
  });
  mockAccess(role);
  vi.mocked(listSalesHistory).mockResolvedValue({
    data: { sales: [summary] },
    meta: { nextCursor: "opaque-next" },
  });
  vi.mocked(getSalesHistoryDetail).mockResolvedValue(detail);
  vi.stubGlobal("print", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("sales history UI", () => {
  it("renders immutable branch-scoped history and forwards the opaque cursor", async () => {
    renderSales();
    expect(
      await screen.findByRole("heading", { name: "Sales history" }),
    ).toBeTruthy();
    expect(await screen.findByText("Historical cashier")).toBeTruthy();
    expect(screen.getByText("THB 12.34")).toBeTruthy();
    await waitFor(() =>
      expect(listSalesHistory).toHaveBeenCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        { cursor: null },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more sales" }));
    await waitFor(() =>
      expect(listSalesHistory).toHaveBeenLastCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        { cursor: "opaque-next" },
      ),
    );
  });

  it("shows loading, empty, and safe error states", async () => {
    vi.mocked(listSalesHistory).mockImplementation(() => new Promise(() => {}));
    renderSales();
    expect(await screen.findByText("Loading sales history…")).toBeTruthy();
    cleanup();
    vi.mocked(listSalesHistory).mockResolvedValue({
      data: { sales: [] },
      meta: { nextCursor: null },
    });
    renderSales();
    expect(await screen.findByText(/No completed sales match/i)).toBeTruthy();
    cleanup();
    vi.mocked(listSalesHistory).mockRejectedValue(
      new SalesApiError("unavailable"),
    );
    renderSales();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /temporarily unavailable/i,
    );
  });

  it("resets the pagination chain when its exact actor filter changes", async () => {
    renderSales();
    await screen.findByText("SALE-IMMUTABLE-001");
    fireEvent.change(screen.getByLabelText("Cashier user ID (optional)"), {
      target: { value: CASHIER_ID },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filter sales history" }),
    );
    await waitFor(() =>
      expect(listSalesHistory).toHaveBeenLastCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        { actorUserId: CASHIER_ID, cursor: null },
      ),
    );
  });

  it("renders cash detail and prints the already fetched immutable sale without cost fields", async () => {
    role = "CASHIER";
    mockAccess(role);
    renderSales();
    await screen.findByText("SALE-IMMUTABLE-001");
    fireEvent.click(screen.getByRole("button", { name: "View detail" }));
    expect((await screen.findAllByText("Historical coffee")).length).toBe(2);
    expect(screen.getAllByText(/Tendered THB 20.00/)).toHaveLength(2);
    expect(screen.queryByText(/COGS|Internal cost/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print receipt" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(getSalesHistoryDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Printable receipt").textContent).not.toMatch(
      /COGS|cost/i,
    );
  });

  it("renders internal cost only when the authorized detail response contains it", async () => {
    const costDetail: SalesHistoryDetail = {
      ...detail,
      items: [
        {
          ...detail.items[0]!,
          cogsAmount: "4.5600000000",
          costBasisState: "KNOWN",
          unitCost: "4.560000",
        },
      ],
    };
    vi.mocked(getSalesHistoryDetail).mockResolvedValue(costDetail);
    renderSales();
    await screen.findByText("SALE-IMMUTABLE-001");
    fireEvent.click(screen.getByRole("button", { name: "View detail" }));
    expect(await screen.findByText(/COGS THB 4.5600000000/)).toBeTruthy();
    expect(screen.getByLabelText("Printable receipt").textContent).not.toMatch(
      /COGS|cost/i,
    );
  });

  it("renders an immutable transfer reference", async () => {
    vi.mocked(getSalesHistoryDetail).mockResolvedValue({
      ...detail,
      payment: {
        amount: "12.34",
        amountTendered: null,
        changeAmount: null,
        method: "TRANSFER",
        reference: "TRANSFER-001",
      },
    });
    renderSales();
    await screen.findByText("SALE-IMMUTABLE-001");
    fireEvent.click(screen.getByRole("button", { name: "View detail" }));
    expect(await screen.findByText(/Reference TRANSFER-001/)).toBeTruthy();
    expect(screen.getByLabelText("Printable receipt").textContent).toMatch(
      /Transfer reference: TRANSFER-001/,
    );
  });

  it("keeps inventory staff out of the history UX", async () => {
    role = "INVENTORY_STAFF";
    mockAccess(role);
    renderSales();
    expect(
      await screen.findByRole("heading", { name: "Sales history unavailable" }),
    ).toBeTruthy();
    expect(listSalesHistory).not.toHaveBeenCalled();
  });
});
