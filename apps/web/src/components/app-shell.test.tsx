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

import HomePage from "@/app/page";
import type {
  AccessContext,
  AccessibleOrganization,
} from "@/branch-api-client";

import { AppShell } from "./app-shell";

const replace = vi.fn();
const push = vi.fn();
let pathname = "/app";
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace, push }),
}));

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";

function accessContext(
  role: AccessibleOrganization["role"] = "OWNER",
): AccessContext {
  return {
    firstOrganizationOnboarding: { eligible: false },
    organizations: [
      {
        branches: [{ code: "MAIN", id: BRANCH, name: "Main branch" }],
        id: ORG,
        name: "Store",
        role,
      },
    ],
    user: {
      displayName: "Owner",
      email: "owner@example.test",
      id: "30000000-0000-4000-8000-000000000001",
    },
  };
}

function renderShell(
  context?: AccessContext,
  children = <p>Module content</p>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (context) client.setQueryData(["access-context"], context);
  render(
    <QueryClientProvider client={client}>
      <AppShell>{children}</AppShell>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  pathname = "/app";
  searchParams = new URLSearchParams();
  replace.mockReset();
  push.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "AUTHENTICATION_REQUIRED" },
        }),
        { status: 401 },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("web application shell", () => {
  it("renders public landmarks without waiting for or requesting a session", () => {
    pathname = "/";
    renderShell(undefined, <HomePage />);
    expect(
      screen.getByRole("heading", { name: /Run your inventory with clarity/ }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Skip to main content" })
        .getAttribute("href"),
    ).toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");
    expect(
      within(screen.getByRole("navigation", { name: "Public navigation" }))
        .getByRole("link", { name: "Sign in" })
        .getAttribute("href"),
    ).toBe("/login");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not offer Sign in after access context confirms authentication", () => {
    renderShell(accessContext());
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav).getByRole("link", { name: "Home" }).getAttribute("href"),
    ).toBe(`/app?organizationId=${ORG}&branchId=${BRANCH}`);
    expect(
      within(nav).getByRole("link", { name: "Inventory" }).getAttribute("href"),
    ).toBe(`/app/inventory?organizationId=${ORG}&branchId=${BRANCH}`);
    expect(
      within(nav)
        .getByRole("link", { name: "Point of sale" })
        .getAttribute("href"),
    ).toBe(`/app/pos?organizationId=${ORG}&branchId=${BRANCH}`);
    expect(
      within(nav)
        .getByRole("link", { name: "Sales history" })
        .getAttribute("href"),
    ).toBe(`/app/sales?organizationId=${ORG}&branchId=${BRANCH}`);
    for (const logo of screen.getAllByRole("link", { name: "StockWise" })) {
      expect(logo.getAttribute("href")).toBe(
        `/app?organizationId=${ORG}&branchId=${BRANCH}`,
      );
    }
  });

  it.each(["/login"])(
    "opens authenticated Home from %s without showing public auth content",
    async (path) => {
      pathname = path;
      renderShell(accessContext(), <p>Sign in</p>);
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          `/app?organizationId=${ORG}&branchId=${BRANCH}`,
        ),
      );
      expect(screen.queryByText("Sign in")).toBeNull();
    },
  );

  it.each(["/", "/pricing"])(
    "keeps %s public when access context is already authenticated",
    (path) => {
      pathname = path;
      renderShell(accessContext());
      expect(screen.getByText("Module content")).toBeTruthy();
      expect(
        screen.getByRole("navigation", { name: "Public navigation" }),
      ).toBeTruthy();
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
      expect(replace).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["OWNER", true, true, true, true],
    ["ADMIN", true, true, true, true],
    ["BRANCH_MANAGER", false, true, true, true],
    ["INVENTORY_STAFF", false, false, true, true],
    ["CASHIER", false, true, false, false],
  ] as const)(
    "preserves %s navigation visibility from server context",
    (role, manage, sales, analytics, suppliers) => {
      renderShell(accessContext(role));
      expect(!!screen.queryByRole("link", { name: "Manage branches" })).toBe(
        manage,
      );
      expect(!!screen.queryByRole("link", { name: "Manage members" })).toBe(
        manage,
      );
      expect(!!screen.queryByRole("link", { name: "Point of sale" })).toBe(
        sales,
      );
      expect(!!screen.queryByRole("link", { name: "Sales history" })).toBe(
        sales,
      );
      expect(!!screen.queryByRole("link", { name: "Analytics" })).toBe(
        analytics,
      );
      expect(!!screen.queryByRole("link", { name: "Suppliers" })).toBe(
        suppliers,
      );
      expect(!!screen.queryByRole("link", { name: "Purchase orders" })).toBe(
        suppliers,
      );
    },
  );

  it("uses resolved scope rather than forged URL candidates and marks the active module", () => {
    pathname = "/app/catalog";
    searchParams = new URLSearchParams({
      organizationId: "unavailable",
      branchId: "revoked",
    });
    renderShell(accessContext());
    const catalog = screen.getByRole("link", { name: "Catalog" });
    expect(catalog.getAttribute("href")).toBe(
      `/app/catalog?organizationId=${ORG}&branchId=${BRANCH}`,
    );
    expect(catalog.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("offers only Home and logout until an organization is chosen", () => {
    const context = accessContext();
    context.organizations.push({
      ...context.organizations[0]!,
      id: "10000000-0000-4000-8000-000000000002",
    });
    renderShell(context);
    expect(
      within(screen.getByRole("navigation"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home"]);
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("hides branch operations when no effective branch remains", () => {
    const context = accessContext("INVENTORY_STAFF");
    context.organizations[0]!.branches = [];
    renderShell(context);
    for (const name of [
      "Inventory",
      "Point of sale",
      "Sales history",
      "Purchase orders",
      "Analytics",
    ]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Catalog" })).toBeTruthy();
  });

  it("keeps logout available for an authenticated user without organization access", () => {
    const context = accessContext();
    context.organizations = [];
    renderShell(context);
    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("href"),
    ).toBe("/app");
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Catalog" })).toBeNull();
  });

  it("toggles the official desktop sidebar while preserving scoped links", () => {
    renderShell(accessContext());
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByRole("link", { name: "Catalog" }).getAttribute("href"),
    ).toBe(`/app/catalog?organizationId=${ORG}&branchId=${BRANCH}`);
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps keyboard focus on the trigger when the desktop sidebar collapses", () => {
    renderShell(accessContext());
    const menu = screen.getByRole("button", { name: "Menu" });
    const sidebar = document.querySelector(
      '[data-slot="sidebar"]',
    ) as HTMLElement;
    const catalog = screen.getByRole("link", { name: "Catalog" });
    expect(sidebar.hasAttribute("inert")).toBe(false);
    catalog.focus();
    expect(document.activeElement).toBe(catalog);
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(menu);
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.hasAttribute("inert")).toBe(false);
    catalog.focus();
    expect(document.activeElement).toBe(catalog);
  });

  it("removes authenticated destinations after access-context revalidation rejects the session", async () => {
    const client = renderShell(accessContext());
    await client.invalidateQueries({ queryKey: ["access-context"] });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });
});
