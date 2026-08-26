import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CatalogApiError,
  createProduct,
  listProducts,
  type CatalogRequestContext,
} from "./catalog-api-client";

const context: CatalogRequestContext = {
  branchId: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
};

const product = {
  barcode: null,
  basePrice: "12.3400",
  categoryId: null,
  createdAt: "2026-08-26T12:00:00.000Z",
  description: null,
  id: "30000000-0000-4000-8000-000000000001",
  name: "Tea",
  organizationId: context.organizationId,
  sku: "TEA-01",
  status: "ACTIVE" as const,
  unit: "EA" as const,
  updatedAt: "2026-08-26T12:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("catalog API client", () => {
  it("uses the same-origin API with the full filter-bound product query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { products: [product] },
          meta: { nextCursor: "next" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listProducts(context, {
        categoryId: "uncategorized",
        cursor: "cursor",
        includeInactive: true,
        q: "tea",
      }),
    ).resolves.toMatchObject({ data: { products: [product] } });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${context.organizationId}/products?branchId=${context.branchId}&categoryId=uncategorized&cursor=cursor&includeInactive=true&q=tea`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("preserves a decimal-string base price without converting it to a number", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { product } }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createProduct(context, {
      barcode: "",
      basePrice: "12.3400",
      categoryId: null,
      description: "",
      name: "Tea",
      sku: "TEA-01",
      unit: "EA",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toContain('"basePrice":"12.3400"');
  });

  it("maps only documented safe public errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "SKU_CONFLICT", message: "internal" },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(
      createProduct(context, {
        barcode: "",
        basePrice: "1",
        categoryId: null,
        description: "",
        name: "Tea",
        sku: "TEA-01",
        unit: "EA",
      }),
    ).rejects.toEqual(new CatalogApiError("sku_conflict"));
  });
});
