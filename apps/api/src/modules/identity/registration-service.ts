import { randomUUID } from "node:crypto";

import type { EmailRequestLimiter } from "./email-request-limiter.ts";
import type { PasswordHasher } from "./password-hasher.ts";
import type {
  VerificationDelivery,
  VerificationResponseDelivery,
} from "./verification-delivery.ts";
import type { VerificationRepository } from "./verification-repository.ts";
import type { VerificationSecurity } from "./verification-security.ts";

export interface RegistrationInput {
  email: string;
  password: string;
}

export interface RegistrationResult {
  challengeId: string;
  proof: string;
  expiresAt: Date;
  delivery: VerificationResponseDelivery | null;
}

export interface RegistrationService {
  register(input: RegistrationInput): Promise<RegistrationResult>;
}

export function createRegistrationService({
  passwordHasher,
  repository,
  security,
  delivery,
  deliveryLimiter,
  now = () => new Date(),
}: {
  passwordHasher: PasswordHasher;
  repository: VerificationRepository;
  security: VerificationSecurity;
  delivery: VerificationDelivery;
  deliveryLimiter: EmailRequestLimiter;
  now?: () => Date;
}): RegistrationService {
  return {
    async register({ email, password }) {
      const admission = deliveryLimiter.consume(email);
      const reservation = admission.allowed ? delivery.reserve() : null;
      try {
        // Every admitted registration hashes before account eligibility is read.
        const passwordHash = await passwordHasher.hash(password);
        const result = await repository.register({
          email,
          passwordHash,
          admitted: reservation !== null,
          prepare: (userId, version, issuedAt) =>
            security.prepare(userId, version, issuedAt),
        });
        if (result === null) {
          reservation?.release();
          const phantom = security.phantom(now());
          return { challengeId: randomUUID(), ...phantom, delivery: null };
        }
        const { prepared } = result;
        if (!result.deliver) reservation?.release();
        return {
          challengeId: prepared.challenge.id,
          proof: prepared.proof,
          expiresAt: prepared.challenge.expiresAt,
          delivery:
            result.deliver && reservation !== null
              ? reservation.prepare({ prepared, recipient: result.recipient })
              : null,
        };
      } catch (error: unknown) {
        reservation?.release();
        throw error;
      }
    },
  };
}
