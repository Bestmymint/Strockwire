import type { Prisma } from "../../generated/prisma/client.ts";
import type { SessionConfiguration } from "./session-configuration.ts";

const selection = {
  id: true,
  userId: true,
  stockwisePurpose: true,
  stockwiseCredentialVersion: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      disabledAt: true,
      emailVerifiedAt: true,
      emailVerified: true,
      passwordChangedAt: true,
      credentialVersion: true,
      nativeRegistrationCompletedAt: true,
      betterAuthAccounts: {
        where: { providerId: "credential", password: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.BetterAuthSessionSelect;

export type NativeAuthoritySession = Prisma.BetterAuthSessionGetPayload<{
  select: typeof selection;
}>;

export function isNativeAuthoritySessionValid(
  session: NativeAuthoritySession,
  userId: string,
  time: number,
  configuration: SessionConfiguration,
): boolean {
  const created = session.createdAt.getTime();
  const updated = session.updatedAt.getTime();
  const completed = session.user.nativeRegistrationCompletedAt?.getTime();
  return (
    Number.isFinite(time) &&
    session.userId === userId &&
    session.user.id === session.userId &&
    session.stockwisePurpose === "APPLICATION" &&
    session.stockwiseCredentialVersion !== null &&
    session.stockwiseCredentialVersion === session.user.credentialVersion &&
    session.user.status === "ACTIVE" &&
    session.user.disabledAt === null &&
    session.user.emailVerifiedAt !== null &&
    session.user.emailVerified &&
    completed !== undefined &&
    completed <= created &&
    session.user.passwordChangedAt.getTime() <= created &&
    session.user.betterAuthAccounts.length > 0 &&
    created <= time &&
    updated <= time &&
    updated >= created &&
    session.expiresAt.getTime() > time &&
    created + configuration.absoluteTimeoutMilliseconds > time &&
    updated + configuration.idleTimeoutMilliseconds > time
  );
}

export interface BetterAuthSessionRepository {
  findSession(input: {
    sessionId: string;
    token: string;
    userId: string;
    configuration: SessionConfiguration;
    now: () => Date;
  }): Promise<NativeAuthoritySession | null>;
}

export function createPrismaBetterAuthSessionRepository(prisma: {
  $transaction<T>(
    action: (
      tx: Pick<Prisma.TransactionClient, "$queryRaw" | "betterAuthSession">,
    ) => Promise<T>,
  ): Promise<T>;
}): BetterAuthSessionRepository {
  return {
    async findSession({ sessionId, token, userId, configuration, now }) {
      return prisma.$transaction(async (tx) => {
        // Reset locks User before deleting sessions. Logout's DELETE contends
        // on the session row. Never insert/upsert a session during activity.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM better_auth_sessions WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid AND token = ${token} FOR UPDATE`;
        const session = await tx.betterAuthSession.findUnique({
          where: { id: sessionId, token },
          select: selection,
        });
        // Sample time after lock waits, never revive a session using request-start time.
        const touchedAt = now();
        const time = touchedAt.getTime();
        if (
          session === null ||
          !isNativeAuthoritySessionValid(session, userId, time, configuration)
        )
          return null;
        if (
          time - session.updatedAt.getTime() >=
          configuration.touchIntervalMilliseconds
        ) {
          // Only activity moves. Native expiry, issue time and token stay fixed.
          await tx.betterAuthSession.update({
            where: { id: sessionId, token },
            data: { updatedAt: touchedAt },
          });
          session.updatedAt = touchedAt;
        }
        return session;
      });
    },
  };
}
