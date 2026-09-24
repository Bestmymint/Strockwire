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

import { ApplicationContextShell } from "./application-context-shell";

const replace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => currentSearchParams,
}));

const ORG_ONE = "10000000-0000-4000-8000-000000000001";
const ORG_TWO = "10000000-0000-4000-8000-000000000002";
const BRANCH_A = "20000000-0000-4000-8000-000000000001";
const BRANCH_B = "20000000-0000-4000-8000-000000000002";

function accessResponse(organizations: unknown[], eligible = false) {
  return new Response(
    JSON.stringify({
      data: {
        firstOrganizationOnboarding: { eligible },
        organizations,
        user: {
          displayName: "Owner",
          email: "owner@example.com",
          id: "30000000-0000-4000-8000-000000000001",
        },
      },
    }),
    { status: 200 },
  );
}

function organization(id = ORG_ONE, role = "OWNER") {
  return {
    branches: [
      { code: "A", id: BRANCH_A, name: "Alpha" },
      { code: "B", id: BRANCH_B, name: "Beta" },
    ],
    id,
    name: id === ORG_ONE ? "Store One" : "Store Two",
    role,
  };
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApplicationContextShell />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  replace.mockReset();
  currentSearchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("application context shell", () => {
  it("keeps setup hidden while access context is loading", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderShell();

    expect(screen.getByText("Loading access…")).toBeTruthy();
    expect(screen.queryByText("Set up StockWise")).toBeNull();
  });

  it("routes an eligible zero-organization user to first setup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(accessResponse([], true)));
    renderShell();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("No active organization access")).toBeNull();
  });

  it("falls back to the sole organization and first code-sorted branch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(accessResponse([organization()])),
    );
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Store One" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Branch")).toHaveProperty("value", BRANCH_A);
    expect(
      screen.getByRole("link", { name: "Catalog" }).getAttribute("href"),
    ).toBe(`/app/catalog?organizationId=${ORG_ONE}&branchId=${BRANCH_A}`);
    expect(
      screen.getByRole("link", { name: "Inventory" }).getAttribute("href"),
    ).toBe(`/app/inventory?organizationId=${ORG_ONE}&branchId=${BRANCH_A}`);
    expect(
      screen.getByRole("link", { name: "Point of sale" }).getAttribute("href"),
    ).toBe(`/app/pos?organizationId=${ORG_ONE}&branchId=${BRANCH_A}`);
    expect(
      screen.getByRole("link", { name: "Sales history" }).getAttribute("href"),
    ).toBe(`/app/sales?organizationId=${ORG_ONE}&branchId=${BRANCH_A}`);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/app?organizationId=${ORG_ONE}&branchId=${BRANCH_A}`,
      ),
    );
    expect(screen.getByRole("link", { name: "Manage branches" })).toBeTruthy();
  });

  it("requires an organization choice when several are accessible", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          accessResponse([organization(), organization(ORG_TWO, "CASHIER")]),
        ),
    );
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Choose an organization" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Store Two" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/app?organizationId=${ORG_TWO}&branchId=${BRANCH_A}`,
      ),
    );
  });

  it("removes the old branch cache before replacing context", async () => {
    currentSearchParams = new URLSearchParams({
      organizationId: ORG_ONE,
      branchId: BRANCH_A,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(accessResponse([organization()])),
    );
    const queryClient = renderShell();
    queryClient.setQueryData(
      ["branch-scoped", ORG_ONE, BRANCH_A, "inventory"],
      { rows: 1 },
    );
    queryClient.setQueryData(
      ["branch-scoped", ORG_ONE, BRANCH_A, "catalog", "products"],
      { rows: 1 },
    );

    const branchSelect = await screen.findByLabelText("Branch");
    fireEvent.change(branchSelect, { target: { value: BRANCH_B } });
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/app?organizationId=${ORG_ONE}&branchId=${BRANCH_B}`,
      ),
    );
    expect(
      queryClient.getQueryData([
        "branch-scoped",
        ORG_ONE,
        BRANCH_A,
        "inventory",
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        "branch-scoped",
        ORG_ONE,
        BRANCH_A,
        "catalog",
        "products",
      ]),
    ).toBeUndefined();
  });

  it("shows a safe no-access state when first onboarding is not eligible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(accessResponse([])));
    renderShell();
    expect(
      await screen.findByRole("heading", {
        name: "No active organization access",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("shows a safe error without rendering setup when access context is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderShell();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your access context could not be loaded.",
    );
    expect(screen.queryByText("Set up StockWise")).toBeNull();
  });

  it("does not offer sales history navigation to inventory staff", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          accessResponse([organization(ORG_ONE, "INVENTORY_STAFF")]),
        ),
    );
    renderShell();

    await screen.findByRole("heading", { name: "Store One" });
    expect(screen.queryByRole("link", { name: "Sales history" })).toBeNull();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeTruthy();
  });
});
