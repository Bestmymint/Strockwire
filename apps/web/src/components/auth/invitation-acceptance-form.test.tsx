// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { acceptInvitation, MembershipApiError } from "@/membership-api-client";

import { InvitationAcceptanceForm } from "./invitation-acceptance-form";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/membership-api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/membership-api-client")>();
  return { ...original, acceptInvitation: vi.fn() };
});

afterEach(() => {
  cleanup();
  replace.mockReset();
  vi.mocked(acceptInvitation).mockReset();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  delete (window as Window & { __stockwiseTakeCredentialLink?: unknown })
    .__stockwiseTakeCredentialLink;
});

function renderInvitation() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <InvitationAcceptanceForm />
    </QueryClientProvider>,
  );
  return client;
}

describe("invitation acceptance form", () => {
  it("submits the transient token, removes it, and navigates to accepted organization", async () => {
    Object.defineProperty(window, "__stockwiseTakeCredentialLink", {
      configurable: true,
      value: vi.fn(() => ({
        route: "/accept-invitation",
        token: "opaque-invitation-token",
      })),
    });
    vi.mocked(acceptInvitation).mockResolvedValue({
      membership: {
        branchAssignments: [],
        createdAt: "2026-08-24T12:00:00.000Z",
        id: "20000000-0000-4000-8000-000000000001",
        organization: { id: ORGANIZATION_ID, name: "Store" },
        role: "ADMIN",
        status: "ACTIVE",
        updatedAt: "2026-08-24T12:00:00.000Z",
        user: {
          displayName: null,
          email: "invitee@example.com",
          id: "30000000-0000-4000-8000-000000000001",
        },
      },
      replayed: false,
    });
    const client = renderInvitation();
    client.setQueryData(["access-context"], {
      organizations: [{ id: "old-org" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith("opaque-invitation-token"),
    );
    expect(window.location.search).toBe("");
    expect(replace).toHaveBeenCalledWith(
      `/app?organizationId=${ORGANIZATION_ID}`,
    );
    expect(client.getQueryData(["access-context"])).toBeUndefined();
    // No SessionLifecycleProvider is mounted in this focused form test;
    // it verifies local cache discard. Browser E2E verifies cross-tab hints.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("guides unauthenticated users without persisting or displaying the token", async () => {
    Object.defineProperty(window, "__stockwiseTakeCredentialLink", {
      configurable: true,
      value: vi.fn(() => ({
        route: "/accept-invitation",
        token: "secret-token-value",
      })),
    });
    vi.mocked(acceptInvitation).mockRejectedValue(
      new MembershipApiError("authentication_required"),
    );
    renderInvitation();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "reopen this invitation link",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-token-value");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("uses generic invalid UX and removes an unusable token", async () => {
    Object.defineProperty(window, "__stockwiseTakeCredentialLink", {
      configurable: true,
      value: vi.fn(() => ({
        route: "/accept-invitation",
        token: "invalid-token",
      })),
    });
    vi.mocked(acceptInvitation).mockRejectedValue(
      new MembershipApiError("invalid_invitation"),
    );
    renderInvitation();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "invalid or expired",
    );
    expect(window.location.search).toBe("");
  });

  it("retains a transient invitation across retryable outages without claiming expiry", async () => {
    Object.defineProperty(window, "__stockwiseTakeCredentialLink", {
      configurable: true,
      value: vi.fn(() => ({
        route: "/accept-invitation",
        token: "synthetic-private-invitation",
      })),
    });
    vi.mocked(acceptInvitation).mockRejectedValue(
      new MembershipApiError("unavailable"),
    );
    renderInvitation();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please try again",
    );
    expect(document.body.textContent).not.toContain(
      "synthetic-private-invitation",
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Accept invitation" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(2));
    expect(acceptInvitation).toHaveBeenNthCalledWith(
      2,
      "synthetic-private-invitation",
    );
  });
});
