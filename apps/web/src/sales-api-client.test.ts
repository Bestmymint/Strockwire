import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkoutSale,
  getSalesHistoryDetail,
  getSalesVatProfile,
  listSalesHistory,
  SalesApiError,
  searchPosProducts,
  updateSalesVatProfile,
} from "./sales-api-client";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const SALE_ID = "40000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("sales API client", () => {
  it("uses the scoped POS product endpoint and only parses the safe product representation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          products: [
            {
              available: true,
              barcode: "8850000000000",
              basePrice: "60.1234",
              id: PRODUCT_ID,
              name: "Coffee",
              sku: "COFFEE",
              unit: "EA",
            },
          ],
        },
        meta: { nextCursor: "next" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await searchPosProducts(
      { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
      { barcode: "8850000000000", q: "coffee" },
    );

    expect(page.data.products[0]).toEqual(
      expect.objectContaining({ basePrice: "60.1234", name: "Coffee" }),
    );
    expect(JSON.stringify(page)).not.toMatch(/cost|quantity|cogs/i);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/v1/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/pos/products?limit=25&barcode=8850000000000&q=coffee`,
    );
  });

  it("sends a same-origin idempotent checkout intent and parses server totals", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            sale: {
              branchCodeSnapshot: "MAIN",
              branchNameSnapshot: "Main",
              currency: "THB",
              discount: null,
              discountAmount: "0.00",
              items: [
                {
                  lineDiscount: "0.00",
                  lineGross: "60.12",
                  lineNet: "60.12",
                  nameSnapshot: "Coffee",
                  quantity: "1",
                  unitPrice: "60.1234",
                  unitSnapshot: "EA",
                },
              ],
              occurredAt: "2026-09-18T10:00:00.000Z",
              outputVatAmount: "0.00",
              payment: {
                amount: "60.12",
                amountTendered: "100.00",
                changeAmount: "39.88",
                method: "CASH",
                reference: null,
              },
              reference: "SALE-001",
              subtotalAmount: "60.12",
              totalAmount: "60.12",
            },
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sale = await checkoutSale(
      { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
      "checkout-key",
      {
        discount: null,
        items: [
          {
            expectedUnitPrice: "60.1234",
            productId: PRODUCT_ID,
            quantity: "1",
          },
        ],
        payment: { amountTendered: "100.00", method: "CASH" },
      },
    );

    expect(sale.totalAmount).toBe("60.12");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "checkout-key" });
    expect(init.body).toContain("60.1234");
  });

  it("gets and updates the owner/admin VAT profile with its exact version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            salesVatProfile: {
              salesVatRate: null,
              salesVatStatus: "UNCONFIGURED",
              updatedAt: "2026-09-18T10:00:00.000Z",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            salesVatProfile: {
              salesVatRate: "7.000000",
              salesVatStatus: "REGISTERED",
              updatedAt: "2026-09-18T10:01:00.000Z",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const profile = await getSalesVatProfile(ORGANIZATION_ID);
    const updated = await updateSalesVatProfile(ORGANIZATION_ID, {
      expectedUpdatedAt: profile.updatedAt,
      salesVatRate: "7.000000",
      salesVatStatus: "REGISTERED",
    });

    expect(updated.salesVatStatus).toBe("REGISTERED");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ).toContain("2026-09-18T10:00:00.000Z");
  });

  it("uses the existing scoped sale reads for history and immutable detail", async () => {
    const summary = {
      actorDisplayName: "Cashier",
      createdAt: "2026-09-18T10:00:00.000Z",
      currency: "THB",
      discount: null,
      discountAmount: "0.00",
      id: SALE_ID,
      itemCount: 1,
      outputVatAmount: "0.00",
      payment: {
        amount: "60.12",
        amountTendered: "100.00",
        changeAmount: "39.88",
        method: "CASH",
        reference: null,
      },
      reference: "SALE-001",
      salesVatRate: null,
      salesVatStatus: "NOT_REGISTERED",
      subtotalAmount: "60.12",
      taxableAmount: null,
      totalAmount: "60.12",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { sales: [summary] },
          meta: { nextCursor: "next" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            sale: {
              ...summary,
              branchCode: "MAIN",
              branchName: "Main",
              items: [
                {
                  id: PRODUCT_ID,
                  lineDiscount: "0.00",
                  lineGross: "60.12",
                  lineNet: "60.12",
                  lineOutputVat: "0.00",
                  lineTaxable: null,
                  productId: PRODUCT_ID,
                  productName: "Historical coffee",
                  productSku: "COFFEE-OLD",
                  quantity: "1.0000",
                  unit: "EA",
                  unitPrice: "60.1234",
                },
              ],
              organizationName: "Store",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID };
    const page = await listSalesHistory(context, {
      actorUserId: "50000000-0000-4000-8000-000000000001",
      cursor: "opaque-next",
    });
    const detail = await getSalesHistoryDetail(context, SALE_ID);

    expect(page.data.sales[0]?.totalAmount).toBe("60.12");
    expect(detail.items[0]?.productName).toBe("Historical coffee");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "sales?limit=25&actorUserId=50000000-0000-4000-8000-000000000001&cursor=opaque-next",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/sales/${SALE_ID}`);
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("/receipt");
  });

  it.each([
    [409, "PRICE_CHANGED", "price_changed"],
    [409, "INSUFFICIENT_STOCK", "insufficient_stock"],
    [409, "VAT_CONFIGURATION_REQUIRED", "vat_configuration_required"],
    [409, "IDEMPOTENCY_CONFLICT", "idempotency_conflict"],
    [403, "FORBIDDEN", "forbidden"],
  ] as const)("maps %s safely", async (status, code, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code } }, status)),
    );

    await expect(
      checkoutSale(
        { branchId: BRANCH_ID, organizationId: ORGANIZATION_ID },
        "checkout-key",
        {
          discount: null,
          items: [],
          payment: { method: "TRANSFER", reference: null },
        },
      ),
    ).rejects.toEqual(new SalesApiError(kind));
  });
});
