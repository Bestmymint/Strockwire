import { randomUUID } from "node:crypto";

import type { EmailRequestLimiter } from "./email-request-limiter.ts";
import { hashOneTimeToken } from "./one-time-token.ts";
import type {
  VerificationDelivery,
  VerificationResponseDelivery,
} from "./verification-delivery.ts";
import type { VerificationRepository } from "./verification-repository.ts";
import type { VerificationSecurity } from "./verification-security.ts";

export type VerificationCompletionResult =
  "verified" | "invalid" | "proof_required";
export type VerificationLinkCompletionResult =
  VerificationCompletionResult | "already_verified";
export type VerificationResendResult =
  | { outcome: "limited"; retryAfterSeconds: number }
  | {
      outcome: "accepted";
      challengeId: string;
      delivery: VerificationResponseDelivery | null;
    };

export interface VerificationService {
  resend(email: string): Promise<VerificationResendResult>;
  completeCode(input: {
    email: string;
    challengeId: string;
    code: string;
    cookieHeader: string | undefined;
  }): Promise<VerificationCompletionResult>;
  completeLink(input: {
    token: string;
    cookieHeader: string | undefined;
  }): Promise<VerificationLinkCompletionResult>;
}

export function createVerificationService({
  repository,
  security,
  delivery,
  deliveryLimiter,
}: {
  repository: VerificationRepository;
  security: VerificationSecurity;
  delivery: VerificationDelivery;
  deliveryLimiter: EmailRequestLimiter;
}): VerificationService {
  return {
    async resend(email) {
      const admission = deliveryLimiter.consume(email);
      if (!admission.allowed)
        return {
          outcome: "limited",
          retryAfterSeconds: admission.retryAfterSeconds,
        };
      const reservation = delivery.reserve();
      if (reservation === null)
        return {
          outcome: "accepted",
          challengeId: randomUUID(),
          delivery: null,
        };
      try {
        const issued = await repository.issue({
          email,
          prepare: (userId, version, issuedAt) =>
            security.prepareChallenge(userId, version, issuedAt),
        });
        if (issued === null) {
          reservation.release();
          return {
            outcome: "accepted",
            challengeId: randomUUID(),
            delivery: null,
          };
        }
        return {
          outcome: "accepted",
          challengeId: issued.material.challenge.id,
          delivery: reservation.prepare({
            prepared: issued.material,
            recipient: issued.recipient,
          }),
        };
      } catch (error: unknown) {
        reservation.release();
        throw error;
      }
    },
    completeCode(input) {
      return repository.completeCode({ ...input, security });
    },
    completeLink({ token, cookieHeader }) {
      return repository.completeLink({
        linkTokenHash: hashOneTimeToken(token),
        cookieHeader,
        security,
      });
    },
  };
}
