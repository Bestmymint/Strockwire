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

import { fetchAccessContext } from "@/branch-api-client";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  PurchaseOrderApiError,
  transitionPurchaseOrder,
  updatePurchaseOrder,
} from "@/purchase-order-api-client";
import { listSuppliers } from "@/supplier-api-client";
import { listProducts } from "@/catalog-api-client";

import { PurchaseOrderManagement } from "./purchase-order-management";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "30000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "40000000-0000-4000-8000-000000000001";
const ORDER_ID = "50000000-0000-4000-8000-000000000001";
let role: "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER" =
  "OWNER";
let search = new URLSearchParams({
  branchId: BRANCH_ID,
  organizationId: ORGANIZATION_ID,
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("@/branch-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/branch-api-client")>()),
  fetchAccessContext: vi.fn(),
}));
vi.mock("@/purchase-order-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/purchase-order-api-client")>()),
  createPurchaseOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(),
  transitionPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
}));
vi.mock("@/supplier-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/supplier-api-client")>()),
  listSuppliers: vi.fn(),
}));
vi.mock("@/catalog-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/catalog-api-client")>()),
  listProducts: vi.fn(),
}));

const order = {
  branchId: BRANCH_ID,
  cancelledAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  currency: "THB" as const,
  expectedDate: null,
  expectedTotal: "25.0000",
  id: ORDER_ID,
  items: [
    {
      expectedUnitCost: "12.5000",
      id: "60000000-0000-4000-8000-000000000001",
      productId: PRODUCT_ID,
      productNameSnapshot: "Tea",
      productSkuSnapshot: "TEA-1",
      quantity: "2",
    },
  ],
  orderDate: "2026-09-01",
  orderedAt: null,
  organizationId: ORGANIZATION_ID,
  receivedAt: null,
  reference: "PO-0001",
  status: "DRAFT" as const,
  supplierId: SUPPLIER_ID,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function renderManagement() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseOrderManagement />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  role = "OWNER";
  search = new URLSearchParams({
    branchId: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
  });
  vi.mocked(fetchAccessContext).mockResolvedValue({
    firstOrganizationOnboarding: { eligible: false },
    organizations: [
      {
        branches: [{ code: "MAIN", id: BRANCH_ID, name: "Main" }],
        id: ORGANIZATION_ID,
        name: "Store",
        role,
      },
    ],
    user: {
      displayName: "User",
      email: "user@example.test",
      id: "70000000-0000-4000-8000-000000000001",
    },
  });
  vi.mocked(listSuppliers).mockResolvedValue({
    data: {
      suppliers: [
        {
          address: null,
          contactName: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          email: null,
          id: SUPPLIER_ID,
          name: "Tea Supply",
          organizationId: ORGANIZATION_ID,
          phone: null,
          status: "ACTIVE",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
    meta: { nextCursor: null },
  });
  vi.mocked(listProducts).mockResolvedValue({
    data: {
      products: [
        {
          barcode: null,
          basePrice: "1.0000",
          categoryId: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          description: null,
          id: PRODUCT_ID,
          name: "Tea",
          organizationId: ORGANIZATION_ID,
          sku: "TEA-1",
          status: "ACTIVE",
          unit: "EA",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          barcode: null,
          basePrice: "2.0000",
          categoryId: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          description: null,
          id: "40000000-0000-4000-8000-000000000002",
          name: "Coffee",
          organizationId: ORGANIZATION_ID,
          sku: "COFFEE-1",
          status: "ACTIVE",
          unit: "KG",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
    meta: { nextCursor: null },
  });
  vi.mocked(listPurchaseOrders).mockResolvedValue({
    data: {
      purchaseOrders: [
        { ...order, items: undefined } as Omit<typeof order, "items">,
      ],
    },
    meta: { nextCursor: null },
  });
  vi.mocked(getPurchaseOrder).mockResolvedValue(order);
  vi.mocked(createPurchaseOrder).mockResolvedValue(order);
  vi.mocked(updatePurchaseOrder).mockResolvedValue(order);
  vi.mocked(transitionPurchaseOrder).mockResolvedValue({
    ...order,
    status: "ORDERED",
    orderedAt: "2026-09-01T00:00:01.000Z",
    updatedAt: "2026-09-01T00:00:01.000Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("purchase order management UI", () => {
  it("creates a DRAFT with string quantity and cost and prevents a duplicate product line", async () => {
    renderManagement();
    const form = await screen.findByRole("form", {
      name: "Create draft purchase order",
    });
    await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
    fireEvent.change(within(form).getByLabelText("Supplier"), {
      target: { value: SUPPLIER_ID },
    });
    fireEvent.change(within(form).getByLabelText("Product line 1 product"), {
      target: { value: PRODUCT_ID },
    });
    await waitFor(() =>
      expect(
        within(form).getByLabelText("Product line 1 quantity (EA)"),
      ).toBeTruthy(),
    );
    fireEvent.change(
      within(form).getByLabelText("Product line 1 quantity (EA)"),
      {
        target: { value: "2" },
      },
    );
    fireEvent.change(
      within(form).getByLabelText("Product line 1 expected unit cost (THB)"),
      {
        target: { value: "12.5000" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add product line" }));
    fireEvent.change(within(form).getByLabelText("Product line 2 product"), {
      target: { value: "40000000-0000-4000-8000-000000000002" },
    });
    const secondProduct = within(form).getByLabelText(
      "Product line 2 product",
    ) as HTMLSelectElement;
    expect(
      Array.from(secondProduct.options).some(
        (option) => option.value === PRODUCT_ID,
      ),
    ).toBe(false);
    fireEvent.change(
      within(form).getByLabelText("Product line 2 quantity (KG)"),
      { target: { value: "0.5" } },
    );
    fireEvent.change(
      within(form).getByLabelText("Product line 2 expected unit cost (THB)"),
      { target: { value: "8" } },
    );
    fireEvent.submit(form);
    await waitFor(() =>
      expect(createPurchaseOrder).toHaveBeenCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        expect.objectContaining({
          items: [
            {
              expectedUnitCost: "12.5000",
              productId: PRODUCT_ID,
              quantity: "2",
            },
            {
              expectedUnitCost: "8",
              productId: "40000000-0000-4000-8000-000000000002",
              quantity: "0.5",
            },
          ],
          supplierId: SUPPLIER_ID,
        }),
      ),
    );
  });

  it("uses the server updatedAt for DRAFT edits and renders the returned total", async () => {
    renderManagement();
    await screen.findByText("PO-0001");
    fireEvent.click(screen.getByRole("button", { name: /PO-0001/ }));
    const form = await screen.findByRole("form", {
      name: "Save draft changes",
    });
    expect(
      screen.getByText("Server-calculated expected total: 25.0000 THB"),
    ).toBeTruthy();
    fireEvent.submit(form);
    await waitFor(() =>
      expect(updatePurchaseOrder).toHaveBeenCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        ORDER_ID,
        expect.objectContaining({
          expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
        }),
      ),
    );
  });

  it("requires ORDER confirmation and sends only the constrained lifecycle action", async () => {
    renderManagement();
    await screen.findByText("PO-0001");
    fireEvent.click(screen.getByRole("button", { name: /PO-0001/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Order purchase order" }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));
    await waitFor(() =>
      expect(transitionPurchaseOrder).toHaveBeenCalledWith(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        expect.objectContaining({
          id: ORDER_ID,
          updatedAt: "2026-09-01T00:00:00.000Z",
        }),
        "ORDERED",
      ),
    );
  });

  it("refreshes on a stale write without replaying it", async () => {
    vi.mocked(updatePurchaseOrder).mockRejectedValue(
      new PurchaseOrderApiError("stale"),
    );
    renderManagement();
    await screen.findByText("PO-0001");
    fireEvent.click(screen.getByRole("button", { name: /PO-0001/ }));
    fireEvent.submit(
      await screen.findByRole("form", { name: "Save draft changes" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /changed elsewhere/i,
    );
    expect(updatePurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("does not give CASHIER purchase-order actions", async () => {
    role = "CASHIER";
    vi.mocked(fetchAccessContext).mockResolvedValue({
      firstOrganizationOnboarding: { eligible: false },
      organizations: [
        {
          branches: [{ code: "MAIN", id: BRANCH_ID, name: "Main" }],
          id: ORGANIZATION_ID,
          name: "Store",
          role: "CASHIER",
        },
      ],
      user: {
        displayName: "User",
        email: "user@example.test",
        id: "70000000-0000-4000-8000-000000000001",
      },
    });
    renderManagement();
    expect(
      await screen.findByText(
        "You do not have permission to manage purchase orders.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("form", { name: "Create draft purchase order" }),
    ).toBeNull();
  });
});
