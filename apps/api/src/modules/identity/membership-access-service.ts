import type { IdentityEmailProvider } from "./email-provider.ts";
import {
  type InvitationAcceptOutcome,
  type InvitationIssueOutcome,
  type InvitationListOutcome,
  type InvitationRevokeOutcome,
  type MembershipAccessRepository,
  type MembershipListOutcome,
  type MembershipMutationOutcome,
} from "./membership-access-repository.ts";
import type {
  InvitationCreateInput,
  MembershipReplaceInput,
} from "./membership-access-schemas.ts";
import {
  hashOneTimeToken,
  type OneTimeTokenProvider,
} from "./one-time-token.ts";
import { OneTimeTokenCollisionError } from "./credential-lifecycle-repository.ts";

const INVITATION_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_GENERATION_ATTEMPTS = 3;

export type InvitationCreateOutcome =
  InvitationIssueOutcome | { kind: "delivery_failed" };

export interface MembershipAccessService {
  acceptInvitation(input: {
    actorEmail: string;
    actorUserId: string;
    rawToken: string;
  }): Promise<InvitationAcceptOutcome>;
  createInvitation(input: {
    actorUserId: string;
    invitation: InvitationCreateInput;
    organizationId: string;
  }): Promise<InvitationCreateOutcome>;
  deactivateMembership(input: {
    actorUserId: string;
    expectedUpdatedAt: Date;
    membershipId: string;
    organizationId: string;
  }): Promise<MembershipMutationOutcome>;
  listInvitations(input: {
    actorUserId: string;
    cursor?: string;
    limit: number;
    organizationId: string;
  }): Promise<InvitationListOutcome>;
  listMemberships(input: {
    actorUserId: string;
    cursor?: string;
    includeInactive: boolean;
    limit: number;
    organizationId: string;
  }): Promise<MembershipListOutcome>;
  reactivateMembership(input: {
    actorUserId: string;
    membershipId: string;
    organizationId: string;
    replacement: MembershipReplaceInput;
  }): Promise<MembershipMutationOutcome>;
  replaceMembership(input: {
    actorUserId: string;
    membershipId: string;
    organizationId: string;
    replacement: MembershipReplaceInput;
  }): Promise<MembershipMutationOutcome>;
  revokeInvitation(input: {
    actorUserId: string;
    invitationId: string;
    organizationId: string;
  }): Promise<InvitationRevokeOutcome>;
}

function invitationUrl(origin: string, rawToken: string): string {
  const url = new URL("/accept-invitation", origin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export function createMembershipAccessService({
  emailProvider,
  now = () => new Date(),
  onDeliveryFailure = () => undefined,
  publicWebOrigin,
  repository,
  tokenProvider,
}: {
  emailProvider: IdentityEmailProvider;
  now?: () => Date;
  onDeliveryFailure?: (kind: "invitation" | "invitation_compensation") => void;
  publicWebOrigin: string;
  repository: MembershipAccessRepository;
  tokenProvider: OneTimeTokenProvider;
}): MembershipAccessService {
  return {
    async createInvitation({ actorUserId, invitation, organizationId }) {
      const issuedAt = now();
      const expiresAt = new Date(
        issuedAt.getTime() + INVITATION_LIFETIME_MILLISECONDS,
      );

      for (
        let attempt = 0;
        attempt < MAX_TOKEN_GENERATION_ATTEMPTS;
        attempt += 1
      ) {
        const token = tokenProvider.generate();
        try {
          const outcome = await repository.issueInvitation({
            actorUserId,
            expiresAt,
            invitation,
            issuedAt,
            organizationId,
            tokenHash: token.tokenHash,
          });
          if (outcome.kind !== "success") return outcome;

          try {
            await emailProvider.send({
              kind: "invitation",
              recipient: outcome.recipient,
              url: invitationUrl(publicWebOrigin, token.rawToken),
            });
            return outcome;
          } catch {
            onDeliveryFailure("invitation");
            try {
              await repository.revokeInvitationAfterDeliveryFailure({
                invitationId: outcome.invitationId,
                revokedAt: now(),
              });
            } catch {
              onDeliveryFailure("invitation_compensation");
            }
            return { kind: "delivery_failed" };
          }
        } catch (error: unknown) {
          if (
            error instanceof OneTimeTokenCollisionError &&
            attempt < MAX_TOKEN_GENERATION_ATTEMPTS - 1
          ) {
            continue;
          }
          throw error;
        }
      }
      throw new Error("Invitation token generation attempts were exhausted.");
    },

    acceptInvitation({ actorEmail, actorUserId, rawToken }) {
      return repository.acceptInvitation({
        acceptedAt: now(),
        actorEmail,
        actorUserId,
        tokenHash: hashOneTimeToken(rawToken),
      });
    },

    revokeInvitation({ actorUserId, invitationId, organizationId }) {
      return repository.revokeInvitation({
        actorUserId,
        invitationId,
        now: now(),
        organizationId,
      });
    },

    listInvitations(input) {
      return repository.listInvitations({ ...input, now: now() });
    },

    listMemberships(input) {
      return repository.listMemberships(input);
    },

    replaceMembership(input) {
      return repository.replaceMembership({ ...input, occurredAt: now() });
    },

    deactivateMembership(input) {
      return repository.deactivateMembership({ ...input, occurredAt: now() });
    },

    reactivateMembership(input) {
      return repository.reactivateMembership({ ...input, occurredAt: now() });
    },
  };
}
