import { createHash } from "node:crypto";

import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { EmailRequestLimitResult } from "./email-request-limiter.ts";

const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 15 * 60;

type Client = Pick<PrismaClient, "$transaction">;

export interface NativePasswordResetLimiter {
  consume(canonicalEmail: string): Promise<EmailRequestLimitResult>;
}

function limiterKey(canonicalEmail: string): string {
  return createHash("sha256").update(canonicalEmail).digest("hex");
}

export function createNativePasswordResetLimiter(
  prisma: Client,
): NativePasswordResetLimiter {
  return {
    async consume(canonicalEmail) {
      const keyHash = limiterKey(canonicalEmail);
      return prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<
          Array<{ attempts: number; window_started_at: Date }>
        >`INSERT INTO native_password_reset_quotas
            (key_hash, window_started_at, attempts)
          VALUES (${keyHash}, statement_timestamp(), 1)
          ON CONFLICT (key_hash) DO UPDATE SET
            window_started_at = CASE
              WHEN native_password_reset_quotas.window_started_at <=
                   statement_timestamp() - (${WINDOW_SECONDS} * INTERVAL '1 second')
              THEN statement_timestamp()
              ELSE native_password_reset_quotas.window_started_at
            END,
            attempts = CASE
              WHEN native_password_reset_quotas.window_started_at <=
                   statement_timestamp() - (${WINDOW_SECONDS} * INTERVAL '1 second')
              THEN 1
              ELSE native_password_reset_quotas.attempts + 1
            END
          WHERE native_password_reset_quotas.window_started_at <=
                statement_timestamp() - (${WINDOW_SECONDS} * INTERVAL '1 second')
             OR native_password_reset_quotas.attempts < ${MAX_ATTEMPTS}
          RETURNING attempts, window_started_at`;
        const row = rows[0];
        if (row !== undefined) return { allowed: true };

        const deniedRows = await transaction.$queryRaw<
          Array<{ window_started_at: Date; database_now: Date }>
        >`SELECT window_started_at, clock_timestamp() AS database_now
          FROM native_password_reset_quotas
          WHERE key_hash = ${keyHash}
          FOR UPDATE`;
        const denied = deniedRows[0];
        if (denied === undefined) {
          throw new Error("Native password reset quota row disappeared.");
        }
        const remainingMilliseconds =
          denied.window_started_at.getTime() +
          WINDOW_SECONDS * 1000 -
          denied.database_now.getTime();
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(remainingMilliseconds / 1000),
          ),
        };
      });
    },
  };
}
