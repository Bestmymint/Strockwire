import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import type { AuthenticationSessionRepository } from "../identity/authentication-repository.ts";
import { createAuthenticationMiddleware } from "../identity/authentication-context.ts";
import type { SessionConfiguration } from "../identity/session-configuration.ts";
import { SESSION_COOKIE_NAME } from "../identity/session-cookie.ts";
import type { InventoryRepository } from "./inventory-repository.ts";
import { createInventoryRouter } from "./inventory-router.ts";
import { createInventoryService } from "./inventory-service.ts";

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

describe("inventory router", () => {
  let server: RunningApiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function start({
    authenticated = true,
    overrides = {},
  }: {
    authenticated?: boolean;
    overrides?: Partial<InventoryRepository>;
  } = {}) {
    const authenticationRepository: AuthenticationSessionRepository = {
      resolveSession: vi.fn().mockResolvedValue(
        authenticated
          ? {
              actor: {
                displayName: "Owner",
                email: "owner@example.com",
                id: "trusted-user-id",
              },
              sessionId: "session-id",
            }
          : null,
      ),
    };
    const repository: InventoryRepository = {
      getBalance: vi.fn().mockResolvedValue({
        inventory: {
          balance: { exists: false, quantity: "0", updatedAt: null },
          product: {
            categoryId: null,
            id: PRODUCT_ID,
            name: "Coffee",
            sku: "COF",
            status: "ACTIVE",
            unit: "EA",
          },
        },
        kind: "success",
      }),
      listBalances: vi.fn().mockResolvedValue({
        inventory: [],
        kind: "success",
        nextCursor: null,
      }),
      listHistory: vi.fn().mockResolvedValue({
        kind: "success",
        nextCursor: null,
        transactions: [],
      }),
      ...overrides,
    };
    const router = createInventoryRouter({
      authenticationMiddleware: createAuthenticationMiddleware({
        configuration,
        repository: authenticationRepository,
      }),
      inventoryService: createInventoryService({ repository }),
    });
    server = await startApiServer(createApp({ apiRouter: router, logger }), {
      host: "127.0.0.1",
      port: 0,
    });
    return {
      repository,
      url: `http://${server.address.host}:${server.address.port}/api/v1`,
    };
  }

  function request(url: string) {
    return fetch(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` },
    });
  }

  it("uses only the trusted actor and validated branch scope", async () => {
    const { repository, url } = await start();
    const response = await request(
      `${url}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/inventory?status=ALL`,
    );
    expect(response.status).toBe(200);
    expect(repository.listBalances).toHaveBeenCalledWith({
      actorUserId: "trusted-user-id",
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      query: { limit: 25, status: "ALL" },
    });
    expect(await response.json()).toMatchObject({
      data: [],
      meta: { nextCursor: null, requestId: expect.any(String) },
    });
  });

  it("rejects unauthenticated and invalid history requests before the repository", async () => {
    const unauthenticated = await start({ authenticated: false });
    const unauthorized = await request(
      `${unauthenticated.url}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/inventory/${PRODUCT_ID}`,
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthenticated.repository.getBalance).not.toHaveBeenCalled();
    await server?.stop();
    server = undefined;

    const invalid = await start();
    const response = await request(
      `${invalid.url}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/inventory/${PRODUCT_ID}/transactions?occurredAfter=invalid`,
    );
    expect(response.status).toBe(400);
    expect(invalid.repository.listHistory).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403, "FORBIDDEN"],
    ["not_found", 404, "PRODUCT_NOT_FOUND"],
    ["invalid_cursor", 400, "INVALID_CURSOR"],
  ] as const)("maps history %s safely", async (kind, status, code) => {
    const { url } = await start({
      overrides: { listHistory: vi.fn().mockResolvedValue({ kind }) },
    });
    const response = await request(
      `${url}/organizations/${ORGANIZATION_ID}/branches/${BRANCH_ID}/inventory/${PRODUCT_ID}/transactions`,
    );
    expect(response.status).toBe(status);
    const body = JSON.stringify(await response.json());
    expect(body).toContain(code);
    expect(body).not.toMatch(/Prisma|SQL|constraint/i);
  });
});
