import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listPurchaseOrders,
  purchaseOrderScopeKey,
  transitionPurchaseOrder,
  type PurchaseOrderRequestContext,
} from "./purchase-order-api-client";

const context: PurchaseOrderRequestContext = {
  branchId: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
};

afterEach(() => vi.restoreAllMocks());

describe("purchase order API client", () => {
  it("uses the branch-scoped server list with its filter-bound cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { purchaseOrders: [] },
          meta: { nextCursor: "next" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listPurchaseOrders(context, {
      cursor: "cursor",
      orderDateFrom: "2026-09-01",
      orderDateTo: "2026-09-30",
      status: "DRAFT",
      supplierId: "30000000-0000-4000-8000-000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${context.organizationId}/branches/${context.branchId}/purchase-orders?cursor=cursor&orderDateFrom=2026-09-01&orderDateTo=2026-09-30&status=DRAFT&supplierId=30000000-0000-4000-8000-000000000001`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(purchaseOrderScopeKey(context)).toEqual([
      "branch-scoped",
      context.organizationId,
      context.branchId,
      "purchase-orders",
    ]);
  });

  it("sends only the lifecycle intent and current server version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            purchaseOrder: {
              branchId: context.branchId,
              cancelledAt: null,
              createdAt: "2026-09-01T00:00:00.000Z",
              currency: "THB",
              expectedDate: null,
              expectedTotal: "1.0000",
              id: "40000000-0000-4000-8000-000000000001",
              items: [],
              orderDate: "2026-09-01",
              orderedAt: "2026-09-01T00:00:00.000Z",
              organizationId: context.organizationId,
              receivedAt: null,
              reference: "PO-1",
              status: "ORDERED",
              supplierId: "30000000-0000-4000-8000-000000000001",
              updatedAt: "2026-09-01T00:00:00.001Z",
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await transitionPurchaseOrder(
      context,
      {
        id: "40000000-0000-4000-8000-000000000001",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      "ORDERED",
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(
      '{"expectedUpdatedAt":"2026-09-01T00:00:00.000Z","status":"ORDERED"}',
    );
  });
});
