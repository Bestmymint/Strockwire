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

import { fetchAccessContext, fetchBranches } from "@/branch-api-client";
import {
  createInvitation,
  deactivateMembership,
  fetchInvitations,
  fetchMemberships,
  MembershipApiError,
  reactivateMembership,
  replaceMembership,
  revokeInvitation,
} from "@/membership-api-client";

import { MembershipManagement } from "./membership-management";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const INVITATION_ID = "40000000-0000-4000-8000-000000000001";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
    }),
}));

vi.mock("@/branch-api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/branch-api-client")>();
  return {
    ...original,
    fetchAccessContext: vi.fn(),
    fetchBranches: vi.fn(),
  };
});

vi.mock("@/membership-api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/membership-api-client")>();
  return {
    ...original,
    createInvitation: vi.fn(),
    deactivateMembership: vi.fn(),
    fetchInvitations: vi.fn(),
    fetchMemberships: vi.fn(),
    reactivateMembership: vi.fn(),
    replaceMembership: vi.fn(),
    revokeInvitation: vi.fn(),
  };
});

const branch = {
  address: null,
  code: "MAIN",
  id: BRANCH_ID,
  name: "Main",
  organizationId: ORGANIZATION_ID,
  phone: null,
  status: "ACTIVE" as const,
  updatedAt: "2026-08-24T12:00:00.000Z",
};
const membership = {
  branchAssignments: [
    {
      branch: {
        code: branch.code,
        id: branch.id,
        name: branch.name,
        status: branch.status,
      },
      status: "ACTIVE" as const,
    },
  ],
  createdAt: "2026-08-24T12:00:00.000Z",
  id: MEMBER_ID,
  organization: { id: ORGANIZATION_ID, name: "Store" },
  role: "CASHIER" as const,
  status: "ACTIVE" as const,
  updatedAt: "2026-08-24T12:00:00.000Z",
  user: {
    displayName: "Cashier",
    email: "cashier@example.com",
    id: "50000000-0000-4000-8000-000000000001",
  },
};
const invitation = {
  branchScopes: [
    {
      code: branch.code,
      id: branch.id,
      name: branch.name,
      status: branch.status,
    },
  ],
  createdAt: "2026-08-24T12:00:00.000Z",
  expiresAt: "2026-08-31T12:00:00.000Z",
  id: INVITATION_ID,
  intendedRole: "CASHIER" as const,
  invitedEmail: "invitee@example.com",
  state: "PENDING" as const,
};

function context(role: "OWNER" | "ADMIN" | "CASHIER" = "OWNER") {
  return {
    firstOrganizationOnboarding: { eligible: false },
    organizations: [
      {
        branches: [{ code: branch.code, id: branch.id, name: branch.name }],
        id: ORGANIZATION_ID,
        name: "Store",
        role,
      },
    ],
    user: {
      displayName: "Owner",
      email: "owner@example.com",
      id: "60000000-0000-4000-8000-000000000001",
    },
  };
}

function renderManagement() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <MembershipManagement />
    </QueryClientProvider>,
  );
  return invalidate;
}

beforeEach(() => {
  vi.mocked(fetchAccessContext).mockResolvedValue(context());
  vi.mocked(fetchBranches).mockResolvedValue([branch]);
  vi.mocked(fetchMemberships).mockResolvedValue({
    data: [membership],
    meta: { nextCursor: null },
  });
  vi.mocked(fetchInvitations).mockResolvedValue({
    data: [invitation],
    meta: { nextCursor: null },
  });
  vi.mocked(createInvitation).mockResolvedValue(invitation);
  vi.mocked(revokeInvitation).mockResolvedValue(invitation);
  vi.mocked(replaceMembership).mockResolvedValue(membership);
  vi.mocked(deactivateMembership).mockResolvedValue({
    ...membership,
    status: "INACTIVE",
  });
  vi.mocked(reactivateMembership).mockResolvedValue(membership);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("membership management UI", () => {
  it("gates branch-scoped users without loading management resources", async () => {
    vi.mocked(fetchAccessContext).mockResolvedValue(context("CASHIER"));
    renderManagement();

    expect(
      await screen.findByRole("heading", {
        name: "Member management unavailable",
      }),
    ).toBeTruthy();
    expect(fetchMemberships).not.toHaveBeenCalled();
    expect(fetchInvitations).not.toHaveBeenCalled();
  });

  it("submits explicit branch scope and refreshes management and access context", async () => {
    const invalidate = renderManagement();
    await screen.findByRole("heading", { name: "Members" });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click((await screen.findAllByLabelText("MAIN — Main"))[0]!);
    fireEvent.submit(
      screen.getByRole("button", { name: "Send invitation" }).closest("form")!,
    );

    await waitFor(() =>
      expect(createInvitation).toHaveBeenCalledWith(ORGANIZATION_ID, {
        branchIds: [BRANCH_ID],
        email: "new@example.com",
        role: "CASHIER",
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["access-context"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["members", ORGANIZATION_ID],
    });
  });

  it("supports revoke, full replacement, deactivation, and stale feedback", async () => {
    renderManagement();
    await screen.findByText("invitee@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(revokeInvitation).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        INVITATION_ID,
      ),
    );

    fireEvent.change(screen.getAllByLabelText("Role")[1]!, {
      target: { value: "ADMIN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() =>
      expect(replaceMembership).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        MEMBER_ID,
        {
          branchIds: [],
          expectedUpdatedAt: membership.updatedAt,
          role: "ADMIN",
        },
      ),
    );

    vi.mocked(deactivateMembership).mockRejectedValueOnce(
      new MembershipApiError("stale"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed");
  });

  it("loads inactive members and offers explicit reactivation", async () => {
    const inactive = { ...membership, status: "INACTIVE" as const };
    vi.mocked(fetchMemberships).mockResolvedValue({
      data: [inactive],
      meta: { nextCursor: null },
    });
    renderManagement();
    await screen.findByText(/INACTIVE/);

    fireEvent.click(
      screen.getByRole("button", { name: "Reactivate with this access" }),
    );
    await waitFor(() =>
      expect(reactivateMembership).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        MEMBER_ID,
        {
          branchIds: [BRANCH_ID],
          expectedUpdatedAt: membership.updatedAt,
          role: "CASHIER",
        },
      ),
    );
  });
});
