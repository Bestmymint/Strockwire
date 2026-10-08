import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadTestDatabaseEnvironment } from "../test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../test/database-harness.ts";
import { testVerificationSecurity } from "../test/identity-backend-fixture.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
beforeEach(() => resetTestDatabase(environment));
afterAll(() => prisma.$disconnect());

async function challenge() {
  const user = await prisma.user.create({
    data: {
      email: "schema@example.test",
      passwordHash: "synthetic-nonsecret-verifier",
    },
  });
  const material = testVerificationSecurity().prepareChallenge(
    user.id,
    1n,
    new Date(),
  );
  const row = await prisma.emailVerificationChallenge.create({
    data: { ...material.challenge, failedOtpAttempts: 0 },
  });
  return { user, row };
}

describe("ADR-034 database challenge invariants", () => {
  it("initializes positive user versions without a mutable-version foreign key", async () => {
    const { user, row } = await challenge();
    expect(user.credentialVersion).toBe(1n);
    await expect(
      prisma.user.update({
        where: { id: user.id },
        data: { credentialVersion: 0n },
      }),
    ).rejects.toThrow();
    await prisma.user.update({
      where: { id: user.id },
      data: { credentialVersion: 2n },
    });
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).credentialVersion,
    ).toBe(1n);
    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
  });

  it("rejects missing new security fields even on terminal target rows", async () => {
    const { row } = await challenge();
    for (const field of [
      "credentialVersion",
      "otpMac",
      "otpKeyId",
      "failedOtpAttempts",
    ] as const) {
      await expect(
        prisma.emailVerificationChallenge.update({
          where: { id: row.id },
          data: {
            [field]: null,
            revokedAt: row.issuedAt,
            revocationReason: "DELIVERY_SUPPRESSED",
          },
        }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.emailVerificationChallenge.update({
        where: { id: row.id },
        data: { isLegacy: true },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.emailVerificationChallenge.create({
        data: {
          userId: row.userId,
          linkTokenHash: "preserved-historical-hash",
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
          revokedAt: row.issuedAt,
          isLegacy: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces digest, attempt, key and exact ten-minute boundaries", async () => {
    const { row } = await challenge();
    for (const data of [
      { credentialVersion: 0n },
      { otpKeyId: 0 },
      { failedOtpAttempts: -1 },
      { failedOtpAttempts: 6 },
      { otpMac: "a".repeat(63) },
      { otpMac: "A".repeat(64) },
      { linkTokenHash: "a".repeat(63) },
      { expiresAt: new Date(row.expiresAt.getTime() + 1) },
    ])
      await expect(
        prisma.emailVerificationChallenge.update({
          where: { id: row.id },
          data,
        }),
      ).rejects.toThrow();
    await prisma.emailVerificationChallenge.update({
      where: { id: row.id },
      data: { failedOtpAttempts: 5 },
    });
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).failedOtpAttempts,
    ).toBe(5);
  });

  it("rejects inconsistent terminal transitions and consumption at expiry", async () => {
    const { row } = await challenge();
    for (const data of [
      { consumedAt: row.expiresAt, consumedVia: "OTP" as const },
      { consumedAt: row.issuedAt },
      { consumedVia: "LINK" as const },
      {
        revokedAt: new Date(row.issuedAt.getTime() - 1),
        revocationReason: "DELIVERY_FAILED" as const,
      },
      {
        consumedAt: row.issuedAt,
        consumedVia: "LINK" as const,
        replacedAt: row.issuedAt,
      },
      { revokedAt: row.issuedAt },
      { revocationReason: "PASSWORD_RESET" as const },
    ])
      await expect(
        prisma.emailVerificationChallenge.update({
          where: { id: row.id },
          data,
        }),
      ).rejects.toThrow();
    await prisma.emailVerificationChallenge.update({
      where: { id: row.id },
      data: { consumedAt: row.issuedAt, consumedVia: "OTP" },
    });
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).consumedVia,
    ).toBe("OTP");
  });

  it("permits one nonterminal challenge, preserves terminal history, and keeps link lookup unique", async () => {
    const { row } = await challenge();
    const successor = testVerificationSecurity().prepareChallenge(
      row.userId,
      1n,
      new Date(),
    );
    await expect(
      prisma.emailVerificationChallenge.create({
        data: { ...successor.challenge, failedOtpAttempts: 0 },
      }),
    ).rejects.toThrow();
    await prisma.emailVerificationChallenge.update({
      where: { id: row.id },
      data: { replacedAt: new Date() },
    });
    await prisma.emailVerificationChallenge.create({
      data: { ...successor.challenge, failedOtpAttempts: 0 },
    });
    const other = await prisma.user.create({
      data: {
        email: "other@example.test",
        passwordHash: "synthetic-nonsecret-verifier",
      },
    });
    const duplicate = testVerificationSecurity().prepareChallenge(
      other.id,
      1n,
      new Date(),
    );
    await expect(
      prisma.emailVerificationChallenge.create({
        data: {
          ...duplicate.challenge,
          linkTokenHash: row.linkTokenHash,
          failedOtpAttempts: 0,
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).replacedAt,
    ).not.toBeNull();
  });
});
