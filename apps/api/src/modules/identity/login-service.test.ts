import { describe, expect, it, vi } from "vitest";

import {
  SessionTokenCollisionError,
  type AuthenticationRepository,
  type CredentialUser,
} from "./authentication-repository.ts";
import { createLoginService } from "./login-service.ts";
import { DUMMY_PASSWORD_HASH } from "./password-hasher.ts";
import type { SessionConfiguration } from "./session-configuration.ts";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 7 * 24 * 60 * 60 * 1000,
  idleTimeoutMilliseconds: 24 * 60 * 60 * 1000,
  secureCookie: false,
  touchIntervalMilliseconds: 15 * 60 * 1000,
};
const verifiedUser: CredentialUser = {
  displayName: null,
  email: "user@example.com",
  emailVerifiedAt: new Date("2026-08-23T12:00:00.000Z"),
  id: "00000000-0000-4000-8000-000000000001",
  passwordHash: "encoded-password-hash",
  status: "ACTIVE",
};

function createRepository(
  overrides: Partial<AuthenticationRepository> = {},
): AuthenticationRepository {
  return {
    establishSession: async () => undefined,
    findCredentialUser: async () => verifiedUser,
    ...overrides,
  };
}

describe("login service", () => {
  it("verifies the exact password and creates the accepted session lifetime", async () => {
    const verify = vi.fn(async () => true);
    const establishSession = vi.fn(async () => undefined);
    const service = createLoginService({
      configuration,
      now: () => NOW,
      passwordVerifier: { verify },
      repository: createRepository({ establishSession }),
      tokenProvider: {
        generate: () => ({ rawToken: "A".repeat(43), tokenHash: "token-hash" }),
      },
    });
    const password = "  exact password é  ";

    await expect(
      service.login({
        email: verifiedUser.email,
        existingTokenHash: "old-token-hash",
        password,
      }),
    ).resolves.toEqual({
      outcome: "authenticated",
      rawSessionToken: "A".repeat(43),
      user: {
        displayName: null,
        email: verifiedUser.email,
        id: verifiedUser.id,
      },
    });
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      verifiedUser.passwordHash,
      password,
    );
    expect(establishSession).toHaveBeenCalledExactlyOnceWith({
      absoluteExpiresAt: new Date("2026-08-31T12:00:00.000Z"),
      existingTokenHash: "old-token-hash",
      idleExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      issuedAt: NOW,
      tokenHash: "token-hash",
      userId: verifiedUser.id,
    });
  });

  it("uses the fixed dummy Argon2 verifier for a nonexistent account", async () => {
    const verify = vi.fn(async () => false);
    const establishSession = vi.fn();
    const service = createLoginService({
      configuration,
      passwordVerifier: { verify },
      repository: createRepository({
        establishSession,
        findCredentialUser: async () => null,
      }),
      tokenProvider: {
        generate: () => ({ rawToken: "A".repeat(43), tokenHash: "token-hash" }),
      },
    });

    await expect(
      service.login({
        email: "missing@example.com",
        existingTokenHash: null,
        password: "password-long-enough",
      }),
    ).resolves.toEqual({ outcome: "credential_failure" });
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      DUMMY_PASSWORD_HASH,
      "password-long-enough",
    );
    expect(establishSession).not.toHaveBeenCalled();
  });

  it("returns the same credential failure for a wrong password", async () => {
    const service = createLoginService({
      configuration,
      passwordVerifier: { verify: async () => false },
      repository: createRepository(),
      tokenProvider: {
        generate: () => ({ rawToken: "A".repeat(43), tokenHash: "token-hash" }),
      },
    });

    await expect(
      service.login({
        email: verifiedUser.email,
        existingTokenHash: null,
        password: "wrong-password-long-enough",
      }),
    ).resolves.toEqual({ outcome: "credential_failure" });
  });

  it.each([{ emailVerifiedAt: null }, { status: "DISABLED" as const }])(
    "denies an ineligible account after verifying credentials",
    async (change) => {
      const establishSession = vi.fn();
      const service = createLoginService({
        configuration,
        passwordVerifier: { verify: async () => true },
        repository: createRepository({
          establishSession,
          findCredentialUser: async () => ({ ...verifiedUser, ...change }),
        }),
        tokenProvider: {
          generate: () => ({
            rawToken: "A".repeat(43),
            tokenHash: "token-hash",
          }),
        },
      });

      await expect(
        service.login({
          email: verifiedUser.email,
          existingTokenHash: null,
          password: "password-long-enough",
        }),
      ).resolves.toEqual({ outcome: "account_ineligible" });
      expect(establishSession).not.toHaveBeenCalled();
    },
  );

  it("retries a cryptographically improbable token-hash collision", async () => {
    const establishSession = vi
      .fn<AuthenticationRepository["establishSession"]>()
      .mockRejectedValueOnce(new SessionTokenCollisionError())
      .mockResolvedValueOnce(undefined);
    let generation = 0;
    const service = createLoginService({
      configuration,
      passwordVerifier: { verify: async () => true },
      repository: createRepository({ establishSession }),
      tokenProvider: {
        generate() {
          generation += 1;
          return {
            rawToken: generation === 1 ? "A".repeat(43) : "B".repeat(43),
            tokenHash: `token-hash-${generation}`,
          };
        },
      },
    });

    const result = await service.login({
      email: verifiedUser.email,
      existingTokenHash: null,
      password: "password-long-enough",
    });

    expect(result).toMatchObject({
      outcome: "authenticated",
      rawSessionToken: "B".repeat(43),
    });
    expect(establishSession).toHaveBeenCalledTimes(2);
  });
});
