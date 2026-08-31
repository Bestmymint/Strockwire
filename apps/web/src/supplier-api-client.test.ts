import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupplierApiError,
  listSuppliers,
  setSupplierLifecycle,
  supplierScopeKey,
} from "./supplier-api-client";

const organizationId = "10000000-0000-4000-8000-000000000001";
const supplier = {
  address: null,
  contactName: "Mae",
  createdAt: "2026-08-31T12:00:00.000Z",
  email: "sales@example.test",
  id: "30000000-0000-4000-8000-000000000001",
  name: "Tea Supply",
  organizationId,
  phone: "02-123",
  status: "ACTIVE" as const,
  updatedAt: "2026-08-31T12:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("supplier API client", () => {
  it("uses the organization-scoped same-origin list with its filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { suppliers: [supplier] },
          meta: { nextCursor: "next" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listSuppliers(organizationId, {
        cursor: "cursor",
        limit: 25,
        q: "tea",
        status: "all",
      }),
    ).resolves.toMatchObject({ data: { suppliers: [supplier] } });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${organizationId}/suppliers?cursor=cursor&limit=25&q=tea&status=all`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(supplierScopeKey(organizationId)).toEqual([
      "organization-scoped",
      organizationId,
      "suppliers",
    ]);
  });

  it("uses the dedicated lifecycle command without a branch context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { supplier } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      setSupplierLifecycle(organizationId, supplier),
    ).resolves.toEqual(supplier);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${organizationId}/suppliers/${supplier.id}/deactivate`,
      expect.objectContaining({
        body: "{}",
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("maps only the documented invalid-cursor error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "INVALID_CURSOR" } }), {
          status: 400,
        }),
      ),
    );

    await expect(listSuppliers(organizationId)).rejects.toEqual(
      new SupplierApiError("invalid_cursor"),
    );
  });
});
