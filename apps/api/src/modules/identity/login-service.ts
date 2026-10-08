import type { PasswordVerifier } from "./password-hasher.ts";
import { DUMMY_PASSWORD_HASH } from "./password-hasher.ts";
import type {
  AuthenticationRepository,
  CredentialUser,
} from "./authentication-repository.ts";
import { SessionTokenCollisionError } from "./authentication-repository.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import type { SessionTokenProvider } from "./session-token.ts";
import type { VerificationRepository } from "./verification-repository.ts";
import type { VerificationSecurity } from "./verification-security.ts";

const MAX_TOKEN_GENERATION_ATTEMPTS = 3;

export interface LoginInput {
  email: string;
  existingTokenHash: string | null;
  password: string;
}

export type LoginResult =
  | { outcome: "credential_failure" }
  | { outcome: "account_ineligible" }
  | {
      outcome: "verification_required";
      proof: string;
      expiresAt: Date;
      challengeId: string | null;
    }
  | {
      outcome: "authenticated";
      rawSessionToken: string;
      user: { displayName: string | null; email: string; id: string };
    };

export interface LoginService {
  login(input: LoginInput): Promise<LoginResult>;
  provePassword(input: {
    email: string;
    password: string;
  }): Promise<PasswordProofResult>;
}

export type PasswordProofResult =
  | { outcome: "credential_failure" }
  | { outcome: "account_ineligible" }
  | { outcome: "accepted"; proof: string; expiresAt: Date };

export function createLoginService({
  configuration,
  now = () => new Date(),
  passwordVerifier,
  repository,
  tokenProvider,
  verificationRepository,
  security,
}: {
  configuration: SessionConfiguration;
  now?: () => Date;
  passwordVerifier: PasswordVerifier;
  repository: AuthenticationRepository;
  tokenProvider: SessionTokenProvider;
  verificationRepository: Pick<
    VerificationRepository,
    "proveCredentialSnapshot"
  >;
  security: Pick<VerificationSecurity, "prove" | "phantom">;
}): LoginService {
  async function verifyPassword(email: string, password: string) {
    const user = await repository.findCredentialUser(email);
    const matches = await passwordVerifier.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (user === null || !matches)
      return { outcome: "credential_failure" } as const;
    if (user.status !== "ACTIVE")
      return { outcome: "account_ineligible" } as const;
    return { outcome: "valid", user } as const;
  }

  function proveSnapshot(user: CredentialUser) {
    return verificationRepository.proveCredentialSnapshot({
      userId: user.id,
      passwordHash: user.passwordHash,
      credentialVersion: user.credentialVersion,
      prepare: (userId, version, issuedAt, pending) =>
        pending
          ? security.prove(userId, version, issuedAt)
          : security.phantom(issuedAt),
    });
  }
  return {
    async login({ email, existingTokenHash, password }) {
      const checked = await verifyPassword(email, password);
      if (checked.outcome !== "valid") return checked;
      const { user } = checked;
      if (user.emailVerifiedAt === null) {
        const proof = await proveSnapshot(user);
        if (proof === null || !proof.pending)
          return { outcome: "account_ineligible" };
        return {
          outcome: "verification_required",
          proof: proof.proof,
          expiresAt: proof.expiresAt,
          challengeId: proof.challengeId,
        };
      }

      const issuedAt = now();
      const absoluteExpiresAt = new Date(
        issuedAt.getTime() + configuration.absoluteTimeoutMilliseconds,
      );
      const idleExpiresAt = new Date(
        Math.min(
          issuedAt.getTime() + configuration.idleTimeoutMilliseconds,
          absoluteExpiresAt.getTime(),
        ),
      );

      for (
        let attempt = 0;
        attempt < MAX_TOKEN_GENERATION_ATTEMPTS;
        attempt += 1
      ) {
        const token = tokenProvider.generate();

        try {
          const established = await repository.establishSession({
            absoluteExpiresAt,
            existingTokenHash,
            idleExpiresAt,
            issuedAt,
            tokenHash: token.tokenHash,
            userId: user.id,
            passwordHash: user.passwordHash,
            credentialVersion: user.credentialVersion,
          });
          if (!established) return { outcome: "account_ineligible" };

          return {
            outcome: "authenticated",
            rawSessionToken: token.rawToken,
            user: {
              displayName: user.displayName,
              email: user.email,
              id: user.id,
            },
          };
        } catch (error: unknown) {
          if (
            !(error instanceof SessionTokenCollisionError) ||
            attempt === MAX_TOKEN_GENERATION_ATTEMPTS - 1
          ) {
            throw error;
          }
        }
      }

      throw new Error("Session token generation attempts were exhausted.");
    },
    async provePassword({ email, password }) {
      const checked = await verifyPassword(email, password);
      if (checked.outcome !== "valid") return checked;
      const result = await proveSnapshot(checked.user);
      if (result === null) return { outcome: "account_ineligible" };
      return {
        outcome: "accepted",
        proof: result.proof,
        expiresAt: result.expiresAt,
      };
    },
  };
}
