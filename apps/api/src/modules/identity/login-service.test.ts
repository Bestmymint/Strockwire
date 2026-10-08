import { describe, expect, it, vi } from "vitest";

import {
  SessionTokenCollisionError,
  type AuthenticationRepository,
  type CredentialUser,
} from "./authentication-repository.ts";
import { createLoginService } from "./login-service.ts";
import { DUMMY_PASSWORD_HASH } from "./password-hasher.ts";
import type { VerificationRepository } from "./verification-repository.ts";
import { testVerificationSecurity } from "../../test/identity-backend-fixture.ts";

const user: CredentialUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "user@example.com",
  displayName: null,
  emailVerifiedAt: new Date(),
  passwordHash: "synthetic-encoded-password",
  credentialVersion: 1n,
  status: "ACTIVE",
};
const configuration = {
  absoluteTimeoutMilliseconds: 604_800_000,
  idleTimeoutMilliseconds: 86_400_000,
  secureCookie: false,
  touchIntervalMilliseconds: 900_000,
};

function service({
  repository = {
    findCredentialUser: async () => user,
    establishSession: async () => true,
  },
  verify = async () => true,
  proofRepository = { proveCredentialSnapshot: async () => null },
  generate = () => ({ rawToken: "A".repeat(43), tokenHash: "a".repeat(64) }),
}: {
  repository?: AuthenticationRepository;
  verify?: (hash: string, password: string) => Promise<boolean>;
  proofRepository?: Pick<VerificationRepository, "proveCredentialSnapshot">;
  generate?: () => { rawToken: string; tokenHash: string };
} = {}) {
  return createLoginService({
    configuration,
    repository,
    passwordVerifier: { verify },
    tokenProvider: { generate },
    verificationRepository: proofRepository,
    security: testVerificationSecurity(),
  });
}

const credentials = {
  email: user.email,
  password: "password-long-enough",
  existingTokenHash: null,
};

describe("login credential authority transitions", () => {
  it("uses the fixed dummy verifier for missing identities and grants no authority", async () => {
    const verify = vi.fn(async () => false);
    const establishSession = vi.fn();
    const login = service({
      repository: { findCredentialUser: async () => null, establishSession },
      verify,
    });
    expect(await login.login(credentials)).toEqual({
      outcome: "credential_failure",
    });
    expect(verify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      credentials.password,
    );
    expect(establishSession).not.toHaveBeenCalled();
  });

  it("rejects wrong passwords and disabled credentials before any authority", async () => {
    expect(
      await service({ verify: async () => false }).login(credentials),
    ).toEqual({ outcome: "credential_failure" });
    const establishSession = vi.fn();
    const disabled = service({
      repository: {
        findCredentialUser: async () => ({ ...user, status: "DISABLED" }),
        establishSession,
      },
    });
    expect(await disabled.login(credentials)).toEqual({
      outcome: "account_ineligible",
    });
    expect(await disabled.provePassword(credentials)).toEqual({
      outcome: "account_ineligible",
    });
    expect(establishSession).not.toHaveBeenCalled();
  });

  it("fails closed when a demonstrated password generation changes before authority is committed", async () => {
    const login = service({
      repository: {
        findCredentialUser: async () => user,
        establishSession: async () => false,
      },
    });
    expect(await login.login(credentials)).toEqual({
      outcome: "account_ineligible",
    });
    const pending = service({
      repository: {
        findCredentialUser: async () => ({ ...user, emailVerifiedAt: null }),
        establishSession: async () => {
          throw new Error("Pending login cannot establish a session");
        },
      },
    });
    expect(await pending.login(credentials)).toEqual({
      outcome: "account_ineligible",
    });
    expect(await pending.provePassword(credentials)).toEqual({
      outcome: "account_ineligible",
    });
  });

  it("retries a fresh token on collision and stops after three collisions", async () => {
    const establishSession = vi
      .fn<AuthenticationRepository["establishSession"]>()
      .mockRejectedValueOnce(new SessionTokenCollisionError())
      .mockResolvedValue(true);
    let generation = 0;
    const generate = () => {
      generation += 1;
      return {
        rawToken: String(generation).repeat(43),
        tokenHash: String(generation).repeat(64),
      };
    };
    expect(
      await service({
        repository: { findCredentialUser: async () => user, establishSession },
        generate,
      }).login(credentials),
    ).toMatchObject({
      outcome: "authenticated",
      rawSessionToken: "2".repeat(43),
    });
    const collisions = vi
      .fn<AuthenticationRepository["establishSession"]>()
      .mockRejectedValue(new SessionTokenCollisionError());
    await expect(
      service({
        repository: {
          findCredentialUser: async () => user,
          establishSession: collisions,
        },
      }).login(credentials),
    ).rejects.toBeInstanceOf(SessionTokenCollisionError);
    expect(collisions).toHaveBeenCalledTimes(3);
  });
});
