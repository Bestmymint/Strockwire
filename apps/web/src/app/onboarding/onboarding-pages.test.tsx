// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "./page";

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

function accessResponse(eligible: boolean, organizations: unknown[] = []) {
  return new Response(
    JSON.stringify({
      data: {
        firstOrganizationOnboarding: { eligible },
        organizations,
        user: {
          displayName: "User",
          email: "user@example.com",
          id: "30000000-0000-4000-8000-000000000001",
        },
      },
    }),
    { status: 200 },
  );
}

function renderPage() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
  vi.unstubAllGlobals();
});

describe("P2-M3-T01 onboarding page", () => {
  it("renders the real onboarding form only for a server-eligible user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(accessResponse(true)));
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Set up StockWise" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("First branch name")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an existing organization",
      false,
      [
        {
          branches: [],
          id: "10000000-0000-4000-8000-000000000001",
          name: "Store",
          role: "OWNER",
        },
      ],
    ],
    ["no effective access and ineligible onboarding", false, []],
  ])(
    "redirects %s to the application",
    async (_name, eligible, organizations) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(accessResponse(eligible, organizations)),
      );
      renderPage();

      await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/app"));
      expect(screen.queryByText("Set up StockWise")).toBeNull();
    },
  );
});
