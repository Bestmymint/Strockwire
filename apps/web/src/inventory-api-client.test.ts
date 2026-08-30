import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInventoryAdjustment,
  InventoryApiError,
  listInventory,
} from "./inventory-api-client";

const context = {
  branchId: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
};
const product = {
  categoryId: null,
  id: "30000000-0000-4000-8000-000000000001",
  name: "Tea",
  sku: "TEA-01",
  status: "ACTIVE",
  unit: "EA",
};

afterEach(() => vi.restoreAllMocks());

describe("inventory API client", () => {
  it("uses the concrete branch-scoped balance endpoint and its documented filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              balance: { exists: false, quantity: "0", updatedAt: null },
              product,
            },
          ],
          meta: { nextCursor: "next" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listInventory(context, {
        categoryId: "uncategorized",
        cursor: "cursor",
        status: "ALL",
      }),
    ).resolves.toMatchObject({ data: [{ balance: { quantity: "0" } }] });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${context.organizationId}/branches/${context.branchId}/inventory?categoryId=uncategorized&cursor=cursor&status=ALL`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("preserves a signed decimal string and the caller's idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            balance: { quantity: "7.75" },
            transaction: {
              delta: "-2.25",
              id: "40000000-0000-4000-8000-000000000001",
              note: "Damaged",
              occurredAt: "2026-08-30T12:00:00.000Z",
              reason: "DAMAGE",
              source: "MANUAL_ADJUSTMENT",
            },
          },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createInventoryAdjustment(context, "submission-key", {
      delta: "-2.25",
      note: "Damaged",
      productId: product.id,
      reason: "DAMAGE",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toContain('"delta":"-2.25"');
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "Idempotency-Key": "submission-key",
    });
  });

  it("maps documented insufficient-stock failures without exposing server internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "INSUFFICIENT_STOCK", message: "internal" },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(
      createInventoryAdjustment(context, "submission-key", {
        delta: "-2",
        note: "",
        productId: product.id,
        reason: "LOSS",
      }),
    ).rejects.toEqual(new InventoryApiError("insufficient_stock"));
  });
});
