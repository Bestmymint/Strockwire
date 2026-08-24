import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { SessionConfiguration } from "./session-configuration.ts";

export interface CredentialUser {
  displayName: string | null;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
}

export interface SessionCreationInput {
  absoluteExpiresAt: Date;
  existingTokenHash: string | null;
  idleExpiresAt: Date;
  issuedAt: Date;
  tokenHash: string;
  userId: string;
}

export interface ResolvedAuthenticationSession {
  actor: {
    displayName: string | null;
    email: string;
    id: string;
  };
  sessionId: string;
}

export interface AuthenticationRepository {
  establishSession(input: SessionCreationInput): Promise<void>;
  findCredentialUser(email: string): Promise<CredentialUser | null>;
}

export interface AuthenticationSessionRepository {
  resolveSession(input: {
    configuration: SessionConfiguration;
    now: Date;
    tokenHash: string;
  }): Promise<ResolvedAuthenticationSession | null>;
}

export class SessionTokenCollisionError extends Error {
  constructor() {
    super("The generated session token hash collided.");
    this.name = "SessionTokenCollisionError";
  }
}

type AuthenticationPrismaClient = Pick<PrismaClient, "$transaction" | "user">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTokenHashTarget(target: unknown): boolean {
  if (typeof target === "string") {
    return (
      target === "sessions_token_hash_key" ||
      target === "tokenHash" ||
      target === "token_hash"
    );
  }

  return (
    Array.isArray(target) &&
    target.some((field) => field === "tokenHash" || field === "token_hash")
  );
}

function hasDriverAdapterTokenHashConstraint(meta: unknown): boolean {
  if (!isRecord(meta) || !isRecord(meta.driverAdapterError)) {
    return false;
  }

  const cause = meta.driverAdapterError.cause;
  if (
    !isRecord(cause) ||
    cause.kind !== "UniqueConstraintViolation" ||
    !isRecord(cause.constraint)
  ) {
    return false;
  }

  return isTokenHashTarget(cause.constraint.fields);
}

export function isSessionTokenHashConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (isTokenHashTarget(error.meta?.target) ||
      hasDriverAdapterTokenHashConstraint(error.meta))
  );
}

function isValidSession(
  session: {
    absoluteExpiresAt: Date;
    idleExpiresAt: Date;
    revokedAt: Date | null;
    user: { emailVerifiedAt: Date | null; status: "ACTIVE" | "DISABLED" };
  },
  now: Date,
): boolean {
  return (
    session.revokedAt === null &&
    session.user.status === "ACTIVE" &&
    session.user.emailVerifiedAt !== null &&
    now < session.idleExpiresAt &&
    now < session.absoluteExpiresAt
  );
}

function shouldTouchSession(
  lastUsedAt: Date,
  now: Date,
  touchIntervalMilliseconds: number,
): boolean {
  return now.getTime() - lastUsedAt.getTime() >= touchIntervalMilliseconds;
}

function nextIdleExpiry(
  now: Date,
  absoluteExpiresAt: Date,
  idleTimeoutMilliseconds: number,
): Date {
  return new Date(
    Math.min(
      now.getTime() + idleTimeoutMilliseconds,
      absoluteExpiresAt.getTime(),
    ),
  );
}

const sessionSelection = {
  absoluteExpiresAt: true,
  id: true,
  idleExpiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  tokenHash: true,
  user: {
    select: {
      displayName: true,
      email: true,
      emailVerifiedAt: true,
      id: true,
      status: true,
    },
  },
} as const;

interface SessionLookupResult {
  absoluteExpiresAt: Date;
  id: string;
  idleExpiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  tokenHash: string;
  user: {
    displayName: string | null;
    email: string;
    emailVerifiedAt: Date | null;
    id: string;
    status: "ACTIVE" | "DISABLED";
  };
}

interface AuthenticationSessionPrismaClient {
  session: {
    findUnique(args: {
      select: typeof sessionSelection;
      where: { tokenHash: string };
    }): Promise<SessionLookupResult | null>;
    updateMany(args: {
      data: { idleExpiresAt: Date; lastUsedAt: Date };
      where: {
        absoluteExpiresAt: { gt: Date };
        id: string;
        idleExpiresAt: { gt: Date };
        lastUsedAt: Date;
        revokedAt: null;
        tokenHash: string;
        user: {
          emailVerifiedAt: { not: null };
          status: "ACTIVE";
        };
      };
    }): Promise<{ count: number }>;
  };
}

export function createPrismaAuthenticationRepository(
  prisma: AuthenticationPrismaClient,
): AuthenticationRepository {
  return {
    async findCredentialUser(email) {
      return prisma.user.findUnique({
        where: { email },
        select: {
          displayName: true,
          email: true,
          emailVerifiedAt: true,
          id: true,
          passwordHash: true,
          status: true,
        },
      });
    },

    async establishSession(input) {
      try {
        await prisma.$transaction(async (transaction) => {
          if (input.existingTokenHash !== null) {
            await transaction.session.updateMany({
              where: {
                absoluteExpiresAt: { gt: input.issuedAt },
                idleExpiresAt: { gt: input.issuedAt },
                revokedAt: null,
                tokenHash: input.existingTokenHash,
                userId: input.userId,
              },
              data: {
                revocationReason: "login_rotation",
                revokedAt: input.issuedAt,
              },
            });
          }

          await transaction.session.create({
            data: {
              absoluteExpiresAt: input.absoluteExpiresAt,
              idleExpiresAt: input.idleExpiresAt,
              issuedAt: input.issuedAt,
              lastUsedAt: input.issuedAt,
              tokenHash: input.tokenHash,
              userId: input.userId,
            },
            select: { id: true },
          });
        });
      } catch (error: unknown) {
        if (isSessionTokenHashConflict(error)) {
          throw new SessionTokenCollisionError();
        }

        throw error;
      }
    },
  };
}

export function createPrismaAuthenticationSessionRepository(
  prisma: AuthenticationSessionPrismaClient,
): AuthenticationSessionRepository {
  return {
    async resolveSession({ configuration, now, tokenHash }) {
      let session = await prisma.session.findUnique({
        where: { tokenHash },
        select: sessionSelection,
      });

      if (session === null || !isValidSession(session, now)) {
        return null;
      }

      if (
        shouldTouchSession(
          session.lastUsedAt,
          now,
          configuration.touchIntervalMilliseconds,
        )
      ) {
        const idleExpiresAt = nextIdleExpiry(
          now,
          session.absoluteExpiresAt,
          configuration.idleTimeoutMilliseconds,
        );
        const touch = await prisma.session.updateMany({
          where: {
            absoluteExpiresAt: { gt: now },
            id: session.id,
            idleExpiresAt: { gt: now },
            lastUsedAt: session.lastUsedAt,
            revokedAt: null,
            tokenHash,
            user: {
              emailVerifiedAt: { not: null },
              status: "ACTIVE",
            },
          },
          data: { idleExpiresAt, lastUsedAt: now },
        });

        if (touch.count === 0) {
          session = await prisma.session.findUnique({
            where: { tokenHash },
            select: sessionSelection,
          });

          if (
            session === null ||
            !isValidSession(session, now) ||
            shouldTouchSession(
              session.lastUsedAt,
              now,
              configuration.touchIntervalMilliseconds,
            )
          ) {
            return null;
          }
        }
      }

      return {
        actor: {
          displayName: session.user.displayName,
          email: session.user.email,
          id: session.user.id,
        },
        sessionId: session.id,
      };
    },
  };
}
