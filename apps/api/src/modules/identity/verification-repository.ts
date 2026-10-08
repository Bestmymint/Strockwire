import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type {
  PreparedVerification,
  VerificationChallengeMaterial,
  VerificationSecurity,
} from "./verification-security.ts";

export interface VerificationRepository {
  register(input: {
    email: string;
    passwordHash: string;
    admitted: boolean;
    prepare: (
      userId: string,
      version: bigint,
      now: Date,
    ) => PreparedVerification;
  }): Promise<{
    prepared: PreparedVerification;
    recipient: string;
    deliver: boolean;
  } | null>;
  issue(input: {
    email: string;
    prepare: (
      userId: string,
      version: bigint,
      now: Date,
    ) => VerificationChallengeMaterial;
  }): Promise<{
    material: VerificationChallengeMaterial;
    recipient: string;
  } | null>;
  completeCode(input: {
    email: string;
    challengeId: string;
    code: string;
    cookieHeader: string | undefined;
    security: VerificationSecurity;
  }): Promise<"verified" | "invalid" | "proof_required">;
  completeLink(input: {
    linkTokenHash: string;
    cookieHeader: string | undefined;
    security: VerificationSecurity;
  }): Promise<"verified" | "invalid" | "proof_required">;
  revokeDelivery(input: {
    challengeId: string;
    reason: "DELIVERY_FAILED" | "RESPONSE_ABORTED";
  }): Promise<void>;
  canDeliver(challengeId: string): Promise<boolean>;
  proveCredentialSnapshot(input: {
    userId: string;
    passwordHash: string;
    credentialVersion: bigint;
    prepare: (
      userId: string,
      version: bigint,
      now: Date,
      pending: boolean,
    ) => { proof: string; expiresAt: Date };
  }): Promise<{
    proof: string;
    expiresAt: Date;
    challengeId: string | null;
    pending: boolean;
  } | null>;
}

type VerificationPrismaClient = Pick<
  PrismaClient,
  "$transaction" | "user" | "emailVerificationChallenge"
>;

const MAX_FAILED_OTP_ATTEMPTS = 5;

async function lockUserByEmail(
  transaction: Prisma.TransactionClient,
  email: string,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM users WHERE email = ${email} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

async function lockUserById(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

async function lockChallengeById(
  transaction: Prisma.TransactionClient,
  challengeId: string,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM email_verification_challenges WHERE id = ${challengeId} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

async function freshDbTime(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS now`,
  );
  const now = rows[0]?.now;
  if (now === undefined) {
    throw new Error("Verification clock query returned no row.");
  }
  return now;
}

async function createOrConflictUser(
  transaction: Prisma.TransactionClient,
  email: string,
  passwordHash: string,
): Promise<{ id: string; created: boolean }> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      INSERT INTO users (id, email, password_hash, updated_at)
      VALUES (${randomUUID()}, ${email}, ${passwordHash}, clock_timestamp())
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `,
  );
  const created = rows[0];
  if (created !== undefined) {
    return { created: true, id: created.id };
  }

  const existing = await transaction.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing === null) {
    throw new Error("Registration user create-or-conflict found no row.");
  }

  return { created: false, id: existing.id };
}

async function readUser(transaction: Prisma.TransactionClient, userId: string) {
  return transaction.user.findUnique({
    where: { id: userId },
    select: {
      credentialVersion: true,
      email: true,
      emailVerifiedAt: true,
      id: true,
      passwordHash: true,
      status: true,
    },
  });
}

async function readChallenge(
  transaction: Prisma.TransactionClient,
  challengeId: string,
) {
  return transaction.emailVerificationChallenge.findUnique({
    where: { id: challengeId },
    select: {
      consumedAt: true,
      credentialVersion: true,
      expiresAt: true,
      failedOtpAttempts: true,
      id: true,
      isLegacy: true,
      otpKeyId: true,
      otpMac: true,
      replacedAt: true,
      revokedAt: true,
      userId: true,
    },
  });
}

function isNonterminal(challenge: {
  consumedAt: Date | null;
  replacedAt: Date | null;
  revokedAt: Date | null;
}): boolean {
  return (
    challenge.consumedAt === null &&
    challenge.replacedAt === null &&
    challenge.revokedAt === null
  );
}

export function createPrismaVerificationRepository(
  prisma: VerificationPrismaClient,
): VerificationRepository {
  return {
    async register({ email, passwordHash, admitted, prepare }) {
      return prisma.$transaction(async (transaction) => {
        const result = await createOrConflictUser(
          transaction,
          email,
          passwordHash,
        );
        const userId = result.id;

        const locked = await lockUserById(transaction, userId);
        if (locked === null) {
          return null;
        }

        const user = await readUser(transaction, userId);
        if (user === null) {
          return null;
        }

        // Verified or disabled duplicates are read-only: no mutation, no
        // challenge, no delivery. The service continues with a phantom proof.
        if (user.emailVerifiedAt !== null || user.status !== "ACTIVE") {
          return null;
        }

        const now = await freshDbTime(transaction);

        if (!admitted) {
          if (!result.created) {
            // Pending duplicate with delivery suppressed: read-only
            // continuation; the existing challenge and credential are kept.
            return null;
          }

          // New account whose delivery quota was denied: install the
          // credential, create the bound challenge, and revoke it immediately
          // so the account remains recoverable by a later resend.
          const prepared = prepare(userId, user.credentialVersion, now);
          await transaction.emailVerificationChallenge.create({
            data: {
              ...prepared.challenge,
              failedOtpAttempts: 0,
            },
          });
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              consumedAt: null,
              id: prepared.challenge.id,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: {
              revocationReason: "DELIVERY_SUPPRESSED",
              revokedAt: now,
            },
          });

          return { deliver: false, prepared, recipient: user.email };
        }

        // Admitted: install/replace the credential and supersede open material.
        const version = result.created
          ? user.credentialVersion
          : user.credentialVersion + 1n;
        const prepared = prepare(userId, version, now);

        if (!result.created) {
          const updated = await transaction.user.updateMany({
            where: { id: userId },
            data: {
              credentialVersion: { increment: 1 },
              passwordChangedAt: now,
              passwordHash,
            },
          });
          if (updated.count !== 1) {
            throw new Error(
              "Registration replacement did not update the user.",
            );
          }
        }

        await transaction.emailVerificationChallenge.updateMany({
          where: {
            consumedAt: null,
            replacedAt: null,
            revokedAt: null,
            userId,
          },
          data: { replacedAt: now },
        });
        await transaction.emailVerificationChallenge.create({
          data: {
            ...prepared.challenge,
            failedOtpAttempts: 0,
          },
        });

        return { deliver: true, prepared, recipient: user.email };
      });
    },

    async issue({ email, prepare }) {
      return prisma.$transaction(async (transaction) => {
        const userId = await lockUserByEmail(transaction, email);
        if (userId === null) {
          return null;
        }

        const user = await readUser(transaction, userId);
        if (
          user === null ||
          user.status !== "ACTIVE" ||
          user.emailVerifiedAt !== null
        ) {
          return null;
        }

        const now = await freshDbTime(transaction);
        const material = prepare(userId, user.credentialVersion, now);

        await transaction.emailVerificationChallenge.updateMany({
          where: {
            consumedAt: null,
            replacedAt: null,
            revokedAt: null,
            userId,
          },
          data: { replacedAt: now },
        });
        await transaction.emailVerificationChallenge.create({
          data: {
            ...material.challenge,
            failedOtpAttempts: 0,
          },
        });

        return { material, recipient: user.email };
      });
    },

    async completeCode({ email, challengeId, code, cookieHeader, security }) {
      return prisma.$transaction(async (transaction) => {
        const userId = await lockUserByEmail(transaction, email);
        if (userId === null) {
          return "invalid";
        }

        const lockedChallenge = await lockChallengeById(
          transaction,
          challengeId,
        );
        if (lockedChallenge === null) {
          return "invalid";
        }

        const user = await readUser(transaction, userId);
        const challenge = await readChallenge(transaction, challengeId);
        if (
          user === null ||
          user.status !== "ACTIVE" ||
          user.emailVerifiedAt !== null ||
          challenge === null ||
          challenge.userId !== userId ||
          !isNonterminal(challenge) ||
          challenge.credentialVersion !== user.credentialVersion
        ) {
          return "invalid";
        }

        const now = await freshDbTime(transaction);
        if (now >= challenge.expiresAt) {
          return "invalid";
        }

        // Mailbox material is validated before the proof. A wrong live OTP
        // increments the durable attempt counter even when no proof is
        // presented, up to the five-attempt bound.
        if (
          challenge.failedOtpAttempts !== null &&
          challenge.failedOtpAttempts >= MAX_FAILED_OTP_ATTEMPTS
        ) {
          return "invalid";
        }

        const otpMatches =
          challenge.otpMac !== null &&
          challenge.otpKeyId !== null &&
          security.matchesOtp(
            {
              id: challenge.id,
              userId: challenge.userId,
              credentialVersion: challenge.credentialVersion,
              otpKeyId: challenge.otpKeyId,
              otpMac: challenge.otpMac,
            },
            code,
          );

        if (!otpMatches) {
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              consumedAt: null,
              id: challenge.id,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: {
              failedOtpAttempts: {
                increment: 1,
              },
            },
          });
          return "invalid";
        }

        const proof = security.readProof(cookieHeader, now);
        if (
          proof === null ||
          !proof.usable ||
          proof.subject !== userId ||
          proof.credentialVersion !== challenge.credentialVersion
        ) {
          return "proof_required";
        }

        const consumed =
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              consumedAt: null,
              id: challenge.id,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: { consumedAt: now, consumedVia: "OTP" },
          });
        if (consumed.count !== 1) {
          return "invalid";
        }

        const verified = await transaction.user.updateMany({
          where: {
            emailVerifiedAt: null,
            id: userId,
            status: "ACTIVE",
          },
          data: { emailVerifiedAt: now },
        });
        if (verified.count !== 1) {
          return "invalid";
        }

        return "verified";
      });
    },

    async completeLink({ linkTokenHash, cookieHeader, security }) {
      return prisma.$transaction(async (transaction) => {
        // Preliminary lookup only locates the user; the row is re-read under
        // lock before any authority is granted.
        const preliminary =
          await transaction.emailVerificationChallenge.findUnique({
            where: { linkTokenHash },
            select: { id: true, userId: true },
          });
        if (preliminary === null) {
          return "invalid";
        }

        const userId = await lockUserById(transaction, preliminary.userId);
        if (userId === null) {
          return "invalid";
        }

        const lockedChallenge = await lockChallengeById(
          transaction,
          preliminary.id,
        );
        if (lockedChallenge === null) {
          return "invalid";
        }

        const user = await readUser(transaction, userId);
        const challenge = await readChallenge(transaction, preliminary.id);
        if (
          user === null ||
          user.status !== "ACTIVE" ||
          user.emailVerifiedAt !== null ||
          challenge === null ||
          challenge.userId !== userId ||
          !isNonterminal(challenge) ||
          challenge.credentialVersion !== user.credentialVersion
        ) {
          return "invalid";
        }

        const now = await freshDbTime(transaction);
        if (now >= challenge.expiresAt) {
          return "invalid";
        }

        const proof = security.readProof(cookieHeader, now);
        if (
          proof === null ||
          !proof.usable ||
          proof.subject !== userId ||
          proof.credentialVersion !== challenge.credentialVersion
        ) {
          return "proof_required";
        }

        const consumed =
          await transaction.emailVerificationChallenge.updateMany({
            where: {
              consumedAt: null,
              id: challenge.id,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: { consumedAt: now, consumedVia: "LINK" },
          });
        if (consumed.count !== 1) {
          return "invalid";
        }

        const verified = await transaction.user.updateMany({
          where: {
            emailVerifiedAt: null,
            id: userId,
            status: "ACTIVE",
          },
          data: { emailVerifiedAt: now },
        });
        if (verified.count !== 1) {
          return "invalid";
        }

        return "verified";
      });
    },

    async revokeDelivery({ challengeId, reason }) {
      await prisma.$transaction(async (transaction) => {
        const challenge =
          await transaction.emailVerificationChallenge.findUnique({
            where: { id: challengeId },
            select: { userId: true },
          });
        if (challenge === null) {
          return;
        }

        const lockedUser = await lockUserById(transaction, challenge.userId);
        if (lockedUser === null) {
          return;
        }

        const lockedChallenge = await lockChallengeById(
          transaction,
          challengeId,
        );
        if (lockedChallenge === null) {
          return;
        }

        const now = await freshDbTime(transaction);
        await transaction.emailVerificationChallenge.updateMany({
          where: {
            consumedAt: null,
            id: challengeId,
            replacedAt: null,
            revokedAt: null,
          },
          data: { revocationReason: reason, revokedAt: now },
        });
      });
    },
    async canDeliver(challengeId) {
      return prisma.$transaction(async (transaction) => {
        const challenge =
          await transaction.emailVerificationChallenge.findUnique({
            where: { id: challengeId },
            select: {
              consumedAt: true,
              credentialVersion: true,
              expiresAt: true,
              isLegacy: true,
              replacedAt: true,
              revokedAt: true,
              user: {
                select: {
                  credentialVersion: true,
                  emailVerifiedAt: true,
                  status: true,
                },
              },
            },
          });

        if (
          challenge === null ||
          !isNonterminal(challenge) ||
          challenge.isLegacy ||
          challenge.credentialVersion === null ||
          challenge.credentialVersion !== challenge.user.credentialVersion ||
          challenge.user.status !== "ACTIVE" ||
          challenge.user.emailVerifiedAt !== null
        ) {
          return false;
        }

        const now = await freshDbTime(transaction);
        return now < challenge.expiresAt;
      });
    },

    async proveCredentialSnapshot({
      userId,
      passwordHash,
      credentialVersion,
      prepare,
    }) {
      return prisma.$transaction(async (transaction) => {
        const locked = await lockUserById(transaction, userId);
        if (locked === null) {
          return null;
        }

        const user = await readUser(transaction, userId);
        if (
          user === null ||
          user.status !== "ACTIVE" ||
          user.passwordHash !== passwordHash ||
          user.credentialVersion !== credentialVersion
        ) {
          return null;
        }

        const pending = user.emailVerifiedAt === null;
        const now = await freshDbTime(transaction);
        const { proof, expiresAt } = prepare(
          userId,
          user.credentialVersion,
          now,
          pending,
        );

        if (!pending) {
          // Verified users receive a parent-supplied phantom proof with no
          // database authority.
          return { challengeId: null, expiresAt, pending: false, proof };
        }

        const challenge =
          await transaction.emailVerificationChallenge.findFirst({
            where: {
              consumedAt: null,
              credentialVersion: user.credentialVersion,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            orderBy: { createdAt: "desc" },
            select: { expiresAt: true, id: true },
          });

        const challengeId =
          challenge !== null && now < challenge.expiresAt ? challenge.id : null;

        return { challengeId, expiresAt, pending: true, proof };
      });
    },
  };
}
