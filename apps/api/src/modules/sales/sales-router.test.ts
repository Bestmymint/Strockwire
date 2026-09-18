import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import type { AuthenticationSessionRepository } from "../identity/authentication-repository.ts";
import { createAuthenticationMiddleware } from "../identity/authentication-context.ts";
import type { SessionConfiguration } from "../identity/session-configuration.ts";
import { SESSION_COOKIE_NAME } from "../identity/session-cookie.ts";
import type {
  CheckoutRepository,
  SafeCheckoutSale,
} from "./checkout-repository.ts";
import { createCheckoutService } from "./checkout-service.ts";
import type { SalesApiRepository } from "./sales-api-repository.ts";
import { createSalesApiService } from "./sales-api-service.ts";
import { createSalesRouter } from "./sales-router.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const TOKEN = "A".repeat(43);
const logger: ApiLogger = { error() {}, info() {} };
const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 604_800_000,
  idleTimeoutMilliseconds: 86_400_000,
  secureCookie: false,
  touchIntervalMilliseconds: 900_000,
};

const sale: SafeCheckoutSale = {
  actorDisplayNameSnapshot: "Cashier",
  branchCodeSnapshot: "MAIN",
  branchId: BRANCH_ID,
  branchNameSnapshot: "Main",
  currency: "THB",
  discount: null,
  discountAmount: "0.00",
  id: "40000000-0000-4000-8000-000000000001",
  items: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      lineDiscount: "0.00",
      lineGross: "60.12",
      lineNet: "60.12",
      lineOutputVat: "0.00",
      lineTaxable: null,
      nameSnapshot: "Coffee",
      productId: PRODUCT_ID,
      quantity: "1",
      skuSnapshot: "COFFEE",
      unitPrice: "60.1234",
      unitSnapshot: "EA",
    },
  ],
  occurredAt: "2026-09-18T10:00:00.000Z",
  organizationId: ORGANIZATION_ID,
  organizationNameSnapshot: "Store",
  outputVatAmount: "0.00",
  payment: {
    amount: "60.12",
    amountTendered: "100.00",
    changeAmount: "39.88",
    method: "CASH",
    reference: null,
  },
  reference: "SALE-40000000-0000-4000-8000-000000000001",
  salesVatStatusSnapshot: "NOT_REGISTERED",
  subtotalAmount: "60.12",
  taxableAmount: null,
  totalAmount: "60.12",
  vatRateSnapshot: null,
};

describe("sales router", () => {
  let server: RunningApiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function start({
    authenticated = true,
    checkout = vi
      .fn<CheckoutRepository["checkout"]>()
      .mockResolvedValue({ kind: "success", sale }),
    getSalesVatProfile = vi
      .fn<SalesApiRepository["getSalesVatProfile"]>()
      .mockResolvedValue({
        kind: "success",
        profile: {
          salesVatRate: null,
          salesVatStatus: "UNCONFIGURED",
          updatedAt: "2026-09-18T10:00:00.000Z",
        },
      }),
    getSalesHistoryDetail = vi
      .fn<SalesApiRepository["getSalesHistoryDetail"]>()
      .mockResolvedValue({ kind: "not_found" }),
    listSalesHistory = vi
      .fn<SalesApiRepository["listSalesHistory"]>()
      .mockResolvedValue({ kind: "success", nextCursor: null, sales: [] }),
    searchPosProducts = vi
      .fn<SalesApiRepository["searchPosProducts"]>()
      .mockResolvedValue({
        kind: "success",
        nextCursor: null,
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
      }),
    updateSalesVatProfile = vi
      .fn<SalesApiRepository["updateSalesVatProfile"]>()
      .mockResolvedValue({
        kind: "success",
        profile: {
          salesVatRate: "7",
          salesVatStatus: "REGISTERED",
          updatedAt: "2026-09-18T10:00:00.001Z",
        },
      }),
  }: {
    authenticated?: boolean;
    checkout?: CheckoutRepository["checkout"];
    getSalesVatProfile?: SalesApiRepository["getSalesVatProfile"];
    getSalesHistoryDetail?: SalesApiRepository["getSalesHistoryDetail"];
    listSalesHistory?: SalesApiRepository["listSalesHistory"];
    searchPosProducts?: SalesApiRepository["searchPosProducts"];
    updateSalesVatProfile?: SalesApiRepository["updateSalesVatProfile"];
  } = {}) {
    const authenticationRepository: AuthenticationSessionRepository = {
      resolveSession: vi.fn().mockResolvedValue(
        authenticated
          ? {
              actor: {
                displayName: "Actor",
                email: "actor@example.com",
                id: "trusted-user-id",
              },
              sessionId: "session-id",
            }
          : null,
      ),
    };
    const salesRepository: SalesApiRepository = {
      getSalesVatProfile,
      getSalesHistoryDetail,
      listSalesHistory,
      searchPosProducts,
      updateSalesVatProfile,
    };
    const router = createSalesRouter({
      authenticationMiddleware: createAuthenticationMiddleware({
        configuration,
        repository: authenticationRepository,
      }),
      checkoutService: createCheckoutService({ repository: { checkout } }),
      publicWebOrigin: "http://localhost:3000",
      salesApiService: createSalesApiService({ repository: salesRepository }),
    });
    server = await startApiServer(createApp({ apiRouter: router, logger }), {
      host: "127.0.0.1",
      port: 0,
    });
    return {
      base: `http://${server.address.host}:${server.address.port}/api/v1`,
      checkout,
      getSalesVatProfile,
      getSalesHistoryDetail,
      listSalesHistory,
      searchPosProducts,
      updateSalesVatProfile,
    };
  }

  function headers(extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${TOKEN}`,
      origin: "http://localhost:3000",
      ...extra,
    };
  }

  function checkoutBody() {
    return {
      items: [
        {
          expectedUnitPrice: "60.1234",
          productId: PRODUCT_ID,
          quantity: "1.0000",
        },
      ],
      payment: { amountTendered: "100.00", method: "CASH" },
    };
  }

  it("passes trusted scope and strict checkout intent to the existing service", async () => {
    const value = await start();
    const response = await fetch(
      `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/sales`,
      {
        body: JSON.stringify(checkoutBody()),
        headers: headers({ "idempotency-key": "checkout-key" }),
        method: "POST",
      },
    );
    expect(response.status).toBe(201);
    expect(value.checkout).toHaveBeenCalledWith({
      actorUserId: "trusted-user-id",
      branchId: BRANCH_ID,
      discount: null,
      idempotencyKey: "checkout-key",
      items: [
        {
          expectedUnitPrice: "60.1234",
          productId: PRODUCT_ID,
          quantity: "1.0000",
        },
      ],
      organizationId: ORGANIZATION_ID,
      payment: { amountTendered: "100.00", method: "CASH" },
    });
    const text = JSON.stringify(await response.json());
    expect(text).toContain('"unitPrice":"60.1234"');
    expect(text).not.toMatch(
      /unitCost|cogs|InventoryCost|canonicalRequestHash/i,
    );
  });

  it("returns an identical checkout replay as 200", async () => {
    const checkout = vi
      .fn<CheckoutRepository["checkout"]>()
      .mockResolvedValue({ kind: "replay", sale });
    const value = await start({ checkout });
    const response = await fetch(
      `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/sales`,
      {
        body: JSON.stringify(checkoutBody()),
        headers: headers({ "idempotency-key": "checkout-key" }),
        method: "POST",
      },
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["forbidden", 403, "FORBIDDEN"],
    ["not_found", 404, "PRODUCT_NOT_FOUND"],
    ["branch_inactive", 409, "BRANCH_INACTIVE"],
    ["product_inactive", 409, "PRODUCT_INACTIVE"],
    ["duplicate_product", 400, "VALIDATION_ERROR"],
    ["invalid_idempotency_key", 400, "VALIDATION_ERROR"],
    ["invalid_quantity", 400, "VALIDATION_ERROR"],
    ["invalid_price", 400, "VALIDATION_ERROR"],
    ["price_changed", 409, "PRICE_CHANGED"],
    ["invalid_discount", 400, "VALIDATION_ERROR"],
    ["invalid_payment", 400, "VALIDATION_ERROR"],
    ["invalid_amounts", 400, "VALIDATION_ERROR"],
    ["vat_configuration_required", 409, "VAT_CONFIGURATION_REQUIRED"],
    ["insufficient_stock", 409, "INSUFFICIENT_STOCK"],
    ["idempotency_conflict", 409, "IDEMPOTENCY_CONFLICT"],
  ] as const)("maps checkout %s safely", async (kind, status, code) => {
    const checkout = vi
      .fn<CheckoutRepository["checkout"]>()
      .mockResolvedValue({ kind });
    const value = await start({ checkout });
    const response = await fetch(
      `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/sales`,
      {
        body: JSON.stringify(checkoutBody()),
        headers: headers({ "idempotency-key": "checkout-key" }),
        method: "POST",
      },
    );
    expect(response.status).toBe(status);
    const text = JSON.stringify(await response.json());
    expect(text).toContain(code);
    expect(text).not.toMatch(/Prisma|SQL|advisory|constraint|stack/i);
  });

  it("rejects unauthenticated, cross-site, missing-key, and non-contract checkout requests", async () => {
    const unauthenticated = await start({ authenticated: false });
    const url = `${unauthenticated.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/sales`;
    expect(
      (
        await fetch(url, {
          body: JSON.stringify(checkoutBody()),
          headers: headers({ "idempotency-key": "key" }),
          method: "POST",
        })
      ).status,
    ).toBe(401);
    await server?.stop();
    server = undefined;

    const value = await start();
    const endpoint = `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/sales`;
    expect(
      (
        await fetch(endpoint, {
          body: JSON.stringify(checkoutBody()),
          headers: headers({
            "idempotency-key": "key",
            origin: "https://evil.example",
          }),
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(endpoint, {
          body: JSON.stringify(checkoutBody()),
          headers: headers(),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(endpoint, {
          body: JSON.stringify({
            ...checkoutBody(),
            organizationId: ORGANIZATION_ID,
          }),
          headers: headers({ "idempotency-key": "key" }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(value.checkout).not.toHaveBeenCalled();
  });

  it("exposes POS-safe search with strict query forwarding", async () => {
    const value = await start();
    const response = await fetch(
      `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/pos/products?q=coffee&barcode=8850000000000&limit=25`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` } },
    );
    expect(response.status).toBe(200);
    expect(value.searchPosProducts).toHaveBeenCalledWith({
      actorUserId: "trusted-user-id",
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      query: { barcode: "8850000000000", limit: 25, q: "coffee" },
    });
    const text = JSON.stringify(await response.json());
    expect(text).toContain('"basePrice":"60.1234"');
    expect(text).not.toMatch(/quantity|cost|cogs/i);
  });

  it("maps POS search authorization, inactive branch, cursor, and invalid query outcomes", async () => {
    for (const [kind, status, code] of [
      ["forbidden", 403, "FORBIDDEN"],
      ["branch_inactive", 409, "BRANCH_INACTIVE"],
      ["invalid_cursor", 400, "INVALID_CURSOR"],
    ] as const) {
      const searchPosProducts = vi
        .fn<SalesApiRepository["searchPosProducts"]>()
        .mockResolvedValue({ kind });
      const value = await start({ searchPosProducts });
      const response = await fetch(
        `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/pos/products`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` } },
      );
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).toContain(code);
      await server?.stop();
      server = undefined;
    }
    const value = await start();
    expect(
      (
        await fetch(
          `${value.base}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/pos/products?limit=101`,
          { headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` } },
        )
      ).status,
    ).toBe(400);
  });

  it("reads and updates the sales VAT profile with CSRF and optimistic input", async () => {
    const value = await start();
    const endpoint = `${value.base}/organizations/${ORGANIZATION_ID}/sales-vat-profile`;
    expect(
      (
        await fetch(endpoint, {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` },
        })
      ).status,
    ).toBe(200);
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        expectedUpdatedAt: "2026-09-18T10:00:00.000Z",
        salesVatRate: "7",
        salesVatStatus: "REGISTERED",
      }),
      headers: headers(),
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    expect(value.updateSalesVatProfile).toHaveBeenCalledWith({
      actorUserId: "trusted-user-id",
      organizationId: ORGANIZATION_ID,
      profile: {
        expectedUpdatedAt: new Date("2026-09-18T10:00:00.000Z"),
        salesVatRate: "7",
        salesVatStatus: "REGISTERED",
      },
    });
  });

  it.each([
    ["forbidden", 403, "FORBIDDEN"],
    ["stale", 409, "SALES_VAT_PROFILE_STALE"],
    ["invalid_profile", 400, "VALIDATION_ERROR"],
  ] as const)("maps VAT profile %s", async (kind, status, code) => {
    const updateSalesVatProfile = vi
      .fn<SalesApiRepository["updateSalesVatProfile"]>()
      .mockResolvedValue({ kind });
    const value = await start({ updateSalesVatProfile });
    const response = await fetch(
      `${value.base}/organizations/${ORGANIZATION_ID}/sales-vat-profile`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: "2026-09-18T10:00:00.000Z",
          salesVatRate: "7",
          salesVatStatus: "REGISTERED",
        }),
        headers: headers(),
        method: "PATCH",
      },
    );
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).toContain(code);
  });
});
