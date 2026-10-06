"use client";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { applicationContextUrl } from "@/application-context";
import {
  fetchAccessContext,
  fetchBranches,
  type AccessibleOrganization,
  type Branch,
} from "@/branch-api-client";
import {
  createInvitation,
  deactivateMembership,
  fetchInvitations,
  fetchMemberships,
  type Invitation,
  type Membership,
  MembershipApiError,
  type MembershipRole,
  reactivateMembership,
  replaceMembership,
  revokeInvitation,
} from "@/membership-api-client";

type MembershipPage = Awaited<ReturnType<typeof fetchMemberships>>;
type InvitationPage = Awaited<ReturnType<typeof fetchInvitations>>;

const BRANCH_ROLES = new Set<MembershipRole>([
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
  "CASHIER",
]);
const ALL_ROLES: MembershipRole[] = [
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
  "CASHIER",
];

function errorMessage(error: unknown): string {
  if (!(error instanceof MembershipApiError)) return "The request failed.";
  const messages: Record<MembershipApiError["kind"], string> = {
    authentication_required: "Sign in again to continue.",
    delivery_failed: "The invitation could not be delivered. Try again.",
    finalized: "That invitation has already been accepted.",
    forbidden: "You do not have permission for this change.",
    invalid_branch_scope: "Choose valid active branches for this role.",
    invalid_invitation: "This invitation is invalid or expired.",
    invitation_scope_invalid:
      "The invitation branch scope is no longer active.",
    last_active_owner: "An organization must retain one active owner.",
    membership_exists:
      "That email already has a membership in this organization.",
    not_found: "The membership no longer exists.",
    stale: "This membership changed. Refresh and try again.",
    state_invalid: "This membership is not in the required state.",
    unavailable: "The membership service is unavailable.",
    validation: "Check the submitted values and try again.",
  };
  return messages[error.kind];
}

export function MembershipManagement() {
  const { t } = useLanguage();

  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId");
  const branchId = searchParams.get("branchId");
  const queryClient = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
  });
  const organization = contextQuery.data?.organizations.find(
    ({ id }) => id === organizationId,
  );
  const canManage =
    organization?.role === "OWNER" || organization?.role === "ADMIN";
  const branchesQuery = useQuery({
    enabled: canManage,
    queryFn: () => fetchBranches(organizationId ?? ""),
    queryKey: ["branches", organizationId, false],
  });
  const membersQuery = useInfiniteQuery<
    MembershipPage,
    Error,
    InfiniteData<MembershipPage>,
    readonly unknown[],
    string | null
  >({
    enabled: canManage,
    getNextPageParam: (page) => page.meta.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchMemberships(organizationId ?? "", includeInactive, pageParam),
    queryKey: ["members", organizationId, includeInactive],
  });
  const invitationsQuery = useInfiniteQuery<
    InvitationPage,
    Error,
    InfiniteData<InvitationPage>,
    readonly unknown[],
    string | null
  >({
    enabled: canManage,
    getNextPageParam: (page) => page.meta.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInvitations(organizationId ?? "", pageParam),
    queryKey: ["invitations", organizationId],
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["access-context"] }),
      queryClient.invalidateQueries({ queryKey: ["members", organizationId] }),
      queryClient.invalidateQueries({
        queryKey: ["invitations", organizationId],
      }),
    ]);
  }

  if (contextQuery.isPending) return <p aria-live="polite">Loading access…</p>;
  if (contextQuery.isError)
    return (
      <p className="form-message" role="alert">
        Your access context could not be loaded.
      </p>
    );
  if (!canManage || organizationId === null || organization === undefined) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">
          Member management unavailable
        </h1>
        <p className="text-muted-foreground">
          Owner or administrator access is required for this organization.
        </p>
        <Link className="underline" href="/app">
          Return to workspace
        </Link>
      </section>
    );
  }

  const branches = branchesQuery.data ?? [];
  const members = membersQuery.data?.pages.flatMap(({ data }) => data) ?? [];
  const invitations =
    invitationsQuery.data?.pages.flatMap(({ data }) => data) ?? [];

  return (
    <section className="w-full space-y-8">
      <header>
        <Link
          className="text-sm underline"
          href={applicationContextUrl(organizationId, branchId)}
        >
          {t("backToWorkspace")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage access for {organization.name}.
        </p>
      </header>

      <InviteForm
        actorRole={organization.role}
        branches={branches}
        onSaved={refresh}
        organizationId={organizationId}
      />

      <section className="space-y-4" aria-labelledby="pending-invitations">
        <h2 className="text-xl font-semibold" id="pending-invitations">
          Pending invitations
        </h2>
        {invitationsQuery.isPending ? <p>Loading invitations…</p> : null}
        {invitationsQuery.isError ? (
          <p className="form-message" role="alert">
            Pending invitations could not be loaded.
          </p>
        ) : null}
        {invitations.map((item) => (
          <InvitationCard
            actorRole={organization.role}
            invitation={item}
            key={item.id}
            onSaved={refresh}
            organizationId={organizationId}
          />
        ))}
        {invitationsQuery.hasNextPage ? (
          <Button
            variant="outline"
            className=""
            onClick={() => void invitationsQuery.fetchNextPage()}
            type="button"
          >
            Load more invitations
          </Button>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="organization-members">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold" id="organization-members">
            Organization members
          </h2>
          <Label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              className=""
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked)}
            />
            Include inactive
          </Label>
        </div>
        {membersQuery.isPending ? <p>Loading members…</p> : null}
        {membersQuery.isError ? (
          <p className="form-message" role="alert">
            Members could not be loaded.
          </p>
        ) : null}
        {members.map((item) => (
          <MemberEditor
            actorRole={organization.role}
            branches={branches}
            key={`${item.id}-${item.updatedAt}`}
            member={item}
            onSaved={refresh}
            organizationId={organizationId}
          />
        ))}
        {membersQuery.hasNextPage ? (
          <Button
            variant="outline"
            className=""
            onClick={() => void membersQuery.fetchNextPage()}
            type="button"
          >
            Load more members
          </Button>
        ) : null}
      </section>
    </section>
  );
}

function InviteForm({
  actorRole,
  branches,
  onSaved,
  organizationId,
}: {
  actorRole: AccessibleOrganization["role"];
  branches: Branch[];
  onSaved: () => Promise<void>;
  organizationId: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("CASHIER");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: () =>
      createInvitation(organizationId, { branchIds, email, role }),
    onSuccess: async () => {
      setEmail("");
      setBranchIds([]);
      await onSaved();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const needsBranchScope = BRANCH_ROLES.has(role) && branchIds.length === 0;

  return (
    <form className="rounded-lg border p-5" onSubmit={submit}>
      <h2 className="text-xl font-semibold">Invite member</h2>
      <div className="mt-4 grid max-w-4xl gap-4 sm:grid-cols-2">
        <Label className="form-field">
          Email
          <Input
            className=""
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Label>
        <RoleSelect
          actorRole={actorRole}
          onChange={(nextRole) => {
            setRole(nextRole);
            if (!BRANCH_ROLES.has(nextRole)) setBranchIds([]);
          }}
          value={role}
        />
      </div>
      <ScopeFields
        branches={branches}
        onChange={setBranchIds}
        role={role}
        selected={branchIds}
      />
      {needsBranchScope ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Select at least one active branch for this role.
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="mt-3 text-sm text-destructive form-message" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <Button
        className="mt-4"
        disabled={mutation.isPending || needsBranchScope}
        type="submit"
      >
        {mutation.isPending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}

function InvitationCard({
  actorRole,
  invitation,
  onSaved,
  organizationId,
}: {
  actorRole: AccessibleOrganization["role"];
  invitation: Invitation;
  onSaved: () => Promise<void>;
  organizationId: string;
}) {
  const canMutate =
    actorRole === "OWNER" || invitation.intendedRole !== "OWNER";
  const revoke = useMutation({
    mutationFn: () => revokeInvitation(organizationId, invitation.id),
    onSuccess: onSaved,
  });
  const reissue = useMutation({
    mutationFn: () =>
      createInvitation(organizationId, {
        branchIds: invitation.branchScopes.map(({ id }) => id),
        email: invitation.invitedEmail,
        role: invitation.intendedRole,
      }),
    onSuccess: onSaved,
  });
  const failure = revoke.error ?? reissue.error;
  return (
    <article className="rounded-lg border p-4">
      <h3 className="font-semibold">{invitation.invitedEmail}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {invitation.intendedRole.replaceAll("_", " ")} · {invitation.state}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {BRANCH_ROLES.has(invitation.intendedRole)
          ? `Branch scope: ${
              invitation.branchScopes
                .map(
                  (branch) =>
                    `${branch.code} — ${branch.name}${branch.status === "INACTIVE" ? " (Inactive)" : ""}`,
                )
                .join(", ") || "No branches assigned"
            }`
          : "Organization-wide scope"}
      </p>
      {failure ? (
        <p className="mt-3 text-sm text-destructive form-message" role="alert">
          {errorMessage(failure)}
        </p>
      ) : null}
      {canMutate ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className=""
            onClick={() => reissue.mutate()}
            type="button"
          >
            Reissue
          </Button>
          <Button
            variant="outline"
            className=""
            onClick={() => revoke.mutate()}
            type="button"
          >
            Revoke
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function MemberEditor({
  actorRole,
  branches,
  member,
  onSaved,
  organizationId,
}: {
  actorRole: AccessibleOrganization["role"];
  branches: Branch[];
  member: Membership;
  onSaved: () => Promise<void>;
  organizationId: string;
}) {
  const [role, setRole] = useState<MembershipRole>(member.role);
  const [branchIds, setBranchIds] = useState(
    member.branchAssignments
      .filter(
        ({ branch, status }) =>
          status === "ACTIVE" && branch.status === "ACTIVE",
      )
      .map(({ branch }) => branch.id),
  );
  const canMutate = actorRole === "OWNER" || member.role !== "OWNER";
  const save = useMutation({
    mutationFn: () =>
      member.status === "ACTIVE"
        ? replaceMembership(organizationId, member.id, {
            branchIds,
            expectedUpdatedAt: member.updatedAt,
            role,
          })
        : reactivateMembership(organizationId, member.id, {
            branchIds,
            expectedUpdatedAt: member.updatedAt,
            role,
          }),
    onSuccess: onSaved,
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateMembership(organizationId, member),
    onSuccess: onSaved,
  });
  const failure = save.error ?? deactivate.error;
  return (
    <article className="rounded-lg border p-5">
      <h3 className="font-semibold">
        {member.user.displayName ?? member.user.email}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {member.user.email} · {member.status}
      </p>
      {canMutate ? (
        <div className="mt-4">
          <RoleSelect
            actorRole={actorRole}
            onChange={(nextRole) => {
              setRole(nextRole);
              if (!BRANCH_ROLES.has(nextRole)) setBranchIds([]);
            }}
            value={role}
          />
          <ScopeFields
            branches={branches}
            onChange={setBranchIds}
            role={role}
            selected={branchIds}
          />
          {failure ? (
            <p
              className="mt-3 text-sm text-destructive form-message"
              role="alert"
            >
              {errorMessage(failure)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              className=""
              onClick={() => save.mutate()}
              type="button"
            >
              {member.status === "ACTIVE"
                ? "Save access"
                : "Reactivate with this access"}
            </Button>
            {member.status === "ACTIVE" ? (
              <Button
                variant="outline"
                className=""
                onClick={() => deactivate.mutate()}
                type="button"
              >
                Deactivate
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Only an owner may change owner access.
        </p>
      )}
    </article>
  );
}

function RoleSelect({
  actorRole,
  onChange,
  value,
}: {
  actorRole: AccessibleOrganization["role"];
  onChange: (role: MembershipRole) => void;
  value: MembershipRole;
}) {
  const roles =
    actorRole === "OWNER"
      ? ALL_ROLES
      : ALL_ROLES.filter((role) => role !== "OWNER");
  return (
    <Label className="form-field">
      Role
      <NativeSelect
        className="w-full mt-1"
        onChange={(event) => onChange(event.target.value as MembershipRole)}
        value={value}
      >
        {roles.map((role) => (
          <NativeSelectOption key={role} value={role}>
            {role.replaceAll("_", " ")}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Label>
  );
}

function ScopeFields({
  branches,
  onChange,
  role,
  selected,
}: {
  branches: Branch[];
  onChange: (branchIds: string[]) => void;
  role: MembershipRole;
  selected: string[];
}) {
  if (!BRANCH_ROLES.has(role)) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        This role has organization-wide access.
      </p>
    );
  }
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium">Active branch scope</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {branches.map((branch) => (
          <Label
            className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm"
            key={branch.id}
          >
            <Checkbox
              className=""
              checked={selected.includes(branch.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, branch.id]
                    : selected.filter((id) => id !== branch.id),
                )
              }
            />
            {branch.code} — {branch.name}
          </Label>
        ))}
      </div>
    </fieldset>
  );
}
