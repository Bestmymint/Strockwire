import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";

export interface IssuedIdentityToken {
  id: string;
  recipient: string;
}

export interface ValidPasswordResetToken {
  tokenId: string;
  userId: string;
}

export interface CredentialLifecycleRepository {
  completePasswordReset(input: {
    completedAt: Date;
    passwordHash: string;
    tokenId: string;
    userId: string;
  }): Promise<boolean>;
  consumeEmailVerificationToken(input: {
    consumedAt: Date;
    tokenHash: string;
  }): Promise<boolean>;
  findValidPasswordResetToken(input: {
    now: Date;
    tokenHash: string;
  }): Promise<ValidPasswordResetToken | null>;
  issueEmailVerificationToken(input: {
    email: string;
    expiresAt: Date;
    issuedAt: Date;
    tokenHash: string;
  }): Promise<IssuedIdentityToken | null>;
  issuePasswordResetToken(input: {
    email: string;
    expiresAt: Date;
    issuedAt: Date;
    tokenHash: string;
  }): Promise<IssuedIdentityToken | null>;
  revokeAllSessions(input: {
    reason: "logout_all";
    revokedAt: Date;
    userId: string;
  }): Promise<void>;
  revokeEmailVerificationToken(input: {
    revokedAt: Date;
    tokenId: string;
  }): Promise<void>;
  revokePasswordResetToken(input: {
    revokedAt: Date;
    tokenId: string;
  }): Promise<void>;
  revokeSessionByTokenHash(input: {
    revokedAt: Date;
    tokenHash: string;
  }): Promise<void>;
}

export class OneTimeTokenCollisionError extends Error {
  constructor() {
    super("The generated one-time token hash collided.");
    this.name = "OneTimeTokenCollisionError";
  }
}

class InvalidPasswordResetStateError extends Error {}
class InvalidVerificationStateError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTokenHashTarget(target: unknown): boolean {
  if (typeof target === "string") {
    return target.includes("token_hash") || target.includes("tokenHash");
  }

  return (
    Array.isArray(target) &&
    target.some((field) => field === "token_hash" || field === "tokenHash")
  );
}

function hasDriverAdapterTokenHashConstraint(meta: unknown): boolean {
  if (!isRecord(meta) || !isRecord(meta.driverAdapterError)) {
    return false;
  }

  const cause = meta.driverAdapterError.cause;
  return (
    isRecord(cause) &&
    cause.kind === "UniqueConstraintViolation" &&
    isRecord(cause.constraint) &&
    isTokenHashTarget(cause.constraint.fields)
  );
}

function isTokenHashConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (isTokenHashTarget(error.meta?.target) ||
      hasDriverAdapterTokenHashConstraint(error.meta))
  );
}

async function lockUserByEmail(
  transaction: Prisma.TransactionClient,
  email: string,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM users WHERE email = ${email} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

export function createPrismaCredentialLifecycleRepository(
  prisma: PrismaClient,
): CredentialLifecycleRepository {
  return {
    async issueEmailVerificationToken(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const userId = await lockUserByEmail(transaction, input.email);
          if (userId === null) {
            return null;
          }

          const user = await transaction.user.findUnique({
            where: { id: userId },
            select: { email: true, emailVerifiedAt: true, status: true },
          });
          if (
            user === null ||
            user.status !== "ACTIVE" ||
            user.emailVerifiedAt !== null
          ) {
            return null;
          }

          await transaction.emailVerificationToken.updateMany({
            where: {
              consumedAt: null,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: { replacedAt: input.issuedAt },
          });
          const token = await transaction.emailVerificationToken.create({
            data: {
              expiresAt: input.expiresAt,
              issuedAt: input.issuedAt,
              tokenHash: input.tokenHash,
              userId,
            },
            select: { id: true },
          });

          return { id: token.id, recipient: user.email };
        });
      } catch (error: unknown) {
        if (isTokenHashConflict(error)) {
          throw new OneTimeTokenCollisionError();
        }
        throw error;
      }
    },

    async revokeEmailVerificationToken({ revokedAt, tokenId }) {
      await prisma.emailVerificationToken.updateMany({
        where: {
          consumedAt: null,
          id: tokenId,
          replacedAt: null,
          revokedAt: null,
        },
        data: { revokedAt },
      });
    },

    async consumeEmailVerificationToken({ consumedAt, tokenHash }) {
      try {
        await prisma.$transaction(async (transaction) => {
          const token = await transaction.emailVerificationToken.findUnique({
            where: { tokenHash },
            select: { id: true, userId: true },
          });
          if (token === null) {
            throw new InvalidVerificationStateError();
          }

          const consumed = await transaction.emailVerificationToken.updateMany({
            where: {
              consumedAt: null,
              expiresAt: { gt: consumedAt },
              id: token.id,
              replacedAt: null,
              revokedAt: null,
            },
            data: { consumedAt },
          });
          if (consumed.count !== 1) {
            throw new InvalidVerificationStateError();
          }

          const verified = await transaction.user.updateMany({
            where: {
              emailVerifiedAt: null,
              id: token.userId,
              status: "ACTIVE",
            },
            data: { emailVerifiedAt: consumedAt },
          });
          if (verified.count !== 1) {
            throw new InvalidVerificationStateError();
          }
        });
        return true;
      } catch (error: unknown) {
        if (error instanceof InvalidVerificationStateError) {
          return false;
        }
        throw error;
      }
    },

    async issuePasswordResetToken(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const userId = await lockUserByEmail(transaction, input.email);
          if (userId === null) {
            return null;
          }

          const user = await transaction.user.findUnique({
            where: { id: userId },
            select: { email: true, emailVerifiedAt: true, status: true },
          });
          if (
            user === null ||
            user.status !== "ACTIVE" ||
            user.emailVerifiedAt === null
          ) {
            return null;
          }

          await transaction.passwordResetToken.updateMany({
            where: {
              consumedAt: null,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: { replacedAt: input.issuedAt },
          });
          const token = await transaction.passwordResetToken.create({
            data: {
              expiresAt: input.expiresAt,
              issuedAt: input.issuedAt,
              tokenHash: input.tokenHash,
              userId,
            },
            select: { id: true },
          });

          return { id: token.id, recipient: user.email };
        });
      } catch (error: unknown) {
        if (isTokenHashConflict(error)) {
          throw new OneTimeTokenCollisionError();
        }
        throw error;
      }
    },

    async revokePasswordResetToken({ revokedAt, tokenId }) {
      await prisma.passwordResetToken.updateMany({
        where: {
          consumedAt: null,
          id: tokenId,
          replacedAt: null,
          revokedAt: null,
        },
        data: { revokedAt },
      });
    },

    async findValidPasswordResetToken({ now, tokenHash }) {
      const token = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          consumedAt: true,
          expiresAt: true,
          id: true,
          replacedAt: true,
          revokedAt: true,
          user: { select: { emailVerifiedAt: true, status: true } },
          userId: true,
        },
      });

      if (
        token === null ||
        token.consumedAt !== null ||
        token.revokedAt !== null ||
        token.replacedAt !== null ||
        now >= token.expiresAt ||
        token.user.status !== "ACTIVE" ||
        token.user.emailVerifiedAt === null
      ) {
        return null;
      }

      return { tokenId: token.id, userId: token.userId };
    },

    async completePasswordReset({
      completedAt,
      passwordHash,
      tokenId,
      userId,
    }) {
      try {
        await prisma.$transaction(async (transaction) => {
          const consumed = await transaction.passwordResetToken.updateMany({
            where: {
              consumedAt: null,
              expiresAt: { gt: completedAt },
              id: tokenId,
              replacedAt: null,
              revokedAt: null,
              userId,
            },
            data: { consumedAt: completedAt },
          });
          if (consumed.count !== 1) {
            throw new InvalidPasswordResetStateError();
          }

          const updated = await transaction.user.updateMany({
            where: {
              emailVerifiedAt: { not: null },
              id: userId,
              status: "ACTIVE",
            },
            data: {
              passwordChangedAt: completedAt,
              passwordHash,
            },
          });
          if (updated.count !== 1) {
            throw new InvalidPasswordResetStateError();
          }

          await transaction.session.updateMany({
            where: { revokedAt: null, userId },
            data: {
              revocationReason: "password_reset",
              revokedAt: completedAt,
            },
          });
        });
        return true;
      } catch (error: unknown) {
        if (error instanceof InvalidPasswordResetStateError) {
          return false;
        }
        throw error;
      }
    },

    async revokeSessionByTokenHash({ revokedAt, tokenHash }) {
      await prisma.session.updateMany({
        where: { revokedAt: null, tokenHash },
        data: { revocationReason: "logout", revokedAt },
      });
    },

    async revokeAllSessions({ reason, revokedAt, userId }) {
      await prisma.session.updateMany({
        where: { revokedAt: null, userId },
        data: { revocationReason: reason, revokedAt },
      });
    },
  };
}
