import { describe, expect, it, vi } from "vitest";

import type { VerificationSecurity } from "./verification-security.ts";
import { createPrismaVerificationRepository } from "./verification-repository.ts";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const ISSUED = new Date(NOW.getTime() - 2 * 60_000);
const EXPIRES = new Date(ISSUED.getTime() + 10 * 60_000);
const CONSUMED = new Date(NOW.getTime() - 1 * 60_000);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CHALLENGE_ID = "22222222-2222-4222-8222-222222222222";
const LINK_HASH = "known-link-hash";

function fixture({
  challengeOverrides = {},
  userOverrides = {},
  now = NOW,
}: {
  challengeOverrides?: Record<string, unknown>;
  userOverrides?: Record<string, unknown>;
  now?: Date;
} = {}) {
  const user = {
    credentialVersion: 1n,
    email: "person@example.invalid",
    emailVerifiedAt: CONSUMED,
    id: USER_ID,
    passwordHash: "not-a-credential",
    status: "ACTIVE",
    ...userOverrides,
  };
  const challenge = {
    id: CHALLENGE_ID,
    userId: USER_ID,
    credentialVersion: 1n,
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    consumedAt: CONSUMED,
    consumedVia: "OTP",
    revokedAt: null,
    replacedAt: null,
    failedOtpAttempts: 0,
    isLegacy: false,
    otpKeyId: 1,
    otpMac: "synthetic-only",
    ...challengeOverrides,
  };
  const updateChallenge = vi.fn();
  const updateUser = vi.fn();
  const readProof = vi.fn(() => null);
  const security = { readProof } as unknown as VerificationSecurity;
  const transaction = {
    $queryRaw: vi.fn(async (sql: { strings: readonly string[] }) => {
      const query = sql.strings.join(" ");
      if (query.includes("SELECT id FROM users WHERE id"))
        return [{ id: USER_ID }];
      if (
        query.includes("SELECT id FROM email_verification_challenges WHERE id")
      )
        return [{ id: CHALLENGE_ID }];
      if (query.includes("SELECT clock_timestamp() AS now")) return [{ now }];
      throw new Error("Unexpected read-only SQL in replay test");
    }),
    user: {
      findUnique: vi.fn(async () => user),
      updateMany: updateUser,
    },
    emailVerificationChallenge: {
      findUnique: vi.fn(
        async ({ where }: { where: Record<string, string> }) => {
          if ("linkTokenHash" in where) {
            return where.linkTokenHash === LINK_HASH
              ? { id: CHALLENGE_ID, userId: USER_ID }
              : null;
          }
          return where.id === CHALLENGE_ID ? challenge : null;
        },
      ),
      updateMany: updateChallenge,
    },
  };
  const repository = createPrismaVerificationRepository({
    $transaction: async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    user: transaction.user,
    emailVerificationChallenge: transaction.emailVerificationChallenge,
  } as unknown as Parameters<typeof createPrismaVerificationRepository>[0]);
  async function result(linkTokenHash = LINK_HASH) {
    return repository.completeLink({
      linkTokenHash,
      cookieHeader: undefined,
      security,
    });
  }
  function expectReadOnly() {
    expect(updateChallenge).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(readProof).not.toHaveBeenCalled();
  }
  return { result, expectReadOnly };
}

describe("ADR-034 ten-minute informational consumed-link replay", () => {
  it.each(["OTP", "LINK"] as const)(
    "recognizes a consumed %s challenge without proof or mutation",
    async (consumedVia) => {
      const test = fixture({ challengeOverrides: { consumedVia } });
      expect(await test.result()).toBe("already_verified");
      test.expectReadOnly();
    },
  );

  it("does not recognize an unknown token", async () => {
    const test = fixture();
    expect(await test.result("unknown-hash")).toBe("invalid");
    test.expectReadOnly();
  });

  it.each([
    ["at expiry", { now: EXPIRES }],
    ["after expiry", { now: new Date(EXPIRES.getTime() + 1) }],
    ["replaced", { challengeOverrides: { replacedAt: CONSUMED } }],
    ["revoked", { challengeOverrides: { revokedAt: CONSUMED } }],
    ["legacy", { challengeOverrides: { isLegacy: true } }],
    [
      "unconsumed",
      { challengeOverrides: { consumedAt: null, consumedVia: null } },
    ],
    [
      "without consumption method",
      { challengeOverrides: { consumedVia: null } },
    ],
    ["stale credential version", { userOverrides: { credentialVersion: 2n } }],
    ["inactive user", { userOverrides: { status: "DISABLED" } }],
    ["not verified", { userOverrides: { emailVerifiedAt: null } }],
  ] as const)(
    "refuses informational replay %s",
    async (_scenario, overrides) => {
      const test = fixture(overrides);
      expect(await test.result()).toBe("invalid");
    },
  );

  it("does not require proof for the informational path but does for pending first use", async () => {
    const test = fixture({
      userOverrides: { emailVerifiedAt: null },
      challengeOverrides: { consumedAt: null, consumedVia: null },
    });
    expect(await test.result()).toBe("proof_required");
  });
});
