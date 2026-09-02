import { afterEach, describe, expect, it, vi } from "vitest";

import {
  receivePurchaseOrder,
  ReceivingApiError,
} from "./receiving-api-client";

const context = {
  branchId: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
};
const orderId = "30000000-0000-4000-8000-000000000001";
const input = {
  actualCosts: [
    {
      actualUnitCost: "12.3400",
      purchaseOrderItemId: "40000000-0000-4000-8000-000000000001",
    },
  ],
  vat: {
    inputVatAmount: "0.8638",
    inputVatRate: "7.000000",
    organizationVatRegistered: true,
    supplierTaxDocumentDate: "2026-09-02",
    supplierTaxDocumentNumber: "TAX-100",
  },
};
const receipt = {
  branchId: context.branchId,
  createdAt: "2026-09-02T10:00:00.000Z",
  id: "50000000-0000-4000-8000-000000000001",
  inputVatAmount: "0.8638",
  inputVatRate: "7.000000",
  items: [
    {
      actualUnitCost: "12.3400",
      id: "60000000-0000-4000-8000-000000000001",
      productId: "70000000-0000-4000-8000-000000000001",
      productNameSnapshot: "Coffee",
      productSkuSnapshot: "COFFEE",
      purchaseOrderItemId: input.actualCosts[0]!.purchaseOrderItemId,
      receivedQuantity: "2",
    },
  ],
  organizationId: context.organizationId,
  organizationVatRegisteredSnapshot: true,
  purchaseOrderId: orderId,
  receivedAt: "2026-09-02T10:00:00.000Z",
  receivedByUserId: "70000000-0000-4000-8000-000000000001",
  reference: "REC-100",
  supplierId: "80000000-0000-4000-8000-000000000001",
  supplierTaxDocumentDate: "2026-09-02",
  supplierTaxDocumentNumber: "TAX-100",
};

afterEach(() => vi.unstubAllGlobals());
describe("receivePurchaseOrder", () => {
  it.each([201, 200])(
    "accepts %i receipt success and sends only receive authority",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { receipt } }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        receivePurchaseOrder(context, orderId, input, "intent-key"),
      ).resolves.toMatchObject({ reference: "REC-100" });
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/organizations/${context.organizationId}/branches/${context.branchId}/purchase-orders/${orderId}/receipts`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Idempotency-Key": "intent-key" }),
        }),
      );
      expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(input);
    },
  );

  it("keeps confirmed API rejection distinct from ambiguous transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT" } }),
            { status: 409 },
          ),
        ),
    );
    await expect(
      receivePurchaseOrder(context, orderId, input, "intent-key"),
    ).rejects.toMatchObject({ kind: "idempotency_conflict" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(
      receivePurchaseOrder(context, orderId, input, "intent-key"),
    ).rejects.toMatchObject({
      kind: "unavailable",
    } satisfies Partial<ReceivingApiError>);
  });
});
