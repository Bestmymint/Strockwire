import type { PasswordVerifier } from "./password-hasher.ts";
import { DUMMY_PASSWORD_HASH } from "./password-hasher.ts";
import type { AuthenticationRepository } from "./authentication-repository.ts";
import { SessionTokenCollisionError } from "./authentication-repository.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import type { SessionTokenProvider } from "./session-token.ts";

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
      outcome: "authenticated";
      rawSessionToken: string;
      user: { displayName: string | null; email: string; id: string };
    };

export interface LoginService {
  login(input: LoginInput): Promise<LoginResult>;
}

export function createLoginService({
  configuration,
  now = () => new Date(),
  passwordVerifier,
  repository,
  tokenProvider,
}: {
  configuration: SessionConfiguration;
  now?: () => Date;
  passwordVerifier: PasswordVerifier;
  repository: AuthenticationRepository;
  tokenProvider: SessionTokenProvider;
}): LoginService {
  return {
    async login({ email, existingTokenHash, password }) {
      const user = await repository.findCredentialUser(email);
      const passwordMatches = await passwordVerifier.verify(
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
        password,
      );

      if (user === null || !passwordMatches) {
        return { outcome: "credential_failure" };
      }

      if (user.status !== "ACTIVE" || user.emailVerifiedAt === null) {
        return { outcome: "account_ineligible" };
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
          await repository.establishSession({
            absoluteExpiresAt,
            existingTokenHash,
            idleExpiresAt,
            issuedAt,
            tokenHash: token.tokenHash,
            userId: user.id,
          });

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
  };
}
