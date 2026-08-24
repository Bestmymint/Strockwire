import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";

export interface UnverifiedUserInput {
  email: string;
  passwordHash: string;
}

export type UnverifiedUserCreateResult = "created" | "duplicate";

export interface RegistrationRepository {
  createUnverifiedUser(
    input: UnverifiedUserInput,
  ): Promise<UnverifiedUserCreateResult>;
}

type RegistrationPrismaClient = Pick<PrismaClient, "user">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmailUniqueTarget(target: unknown): boolean {
  if (typeof target === "string") {
    return target === "users_email_key" || target === "email";
  }

  return Array.isArray(target) && target.some((field) => field === "email");
}

function hasDriverAdapterEmailConstraint(meta: unknown): boolean {
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

  return isEmailUniqueTarget(cause.constraint.fields);
}

export function isCanonicalEmailConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (isEmailUniqueTarget(error.meta?.target) ||
      hasDriverAdapterEmailConstraint(error.meta))
  );
}

export function createPrismaRegistrationRepository(
  prisma: RegistrationPrismaClient,
): RegistrationRepository {
  return {
    async createUnverifiedUser({ email, passwordHash }) {
      try {
        await prisma.user.create({
          data: {
            displayName: null,
            email,
            emailVerifiedAt: null,
            passwordHash,
          },
          select: { id: true },
        });
        return "created";
      } catch (error: unknown) {
        if (isCanonicalEmailConflict(error)) {
          return "duplicate";
        }

        throw error;
      }
    },
  };
}
