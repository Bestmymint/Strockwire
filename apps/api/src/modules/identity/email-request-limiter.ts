import { createHash } from "node:crypto";

const MAX_ATTEMPTS = 3;
const WINDOW_MILLISECONDS = 15 * 60 * 1000;

interface EmailRequestLimitEntry {
  attempts: number;
  expiresAt: number;
}

export type EmailRequestLimitResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface EmailRequestLimiter {
  consume(canonicalEmail: string): EmailRequestLimitResult;
}

function limiterKey(canonicalEmail: string): string {
  return createHash("sha256").update(canonicalEmail).digest("base64url");
}

export function createEmailRequestLimiter(
  now: () => number = Date.now,
): EmailRequestLimiter {
  const entries = new Map<string, EmailRequestLimitEntry>();

  return {
    consume(canonicalEmail) {
      const key = limiterKey(canonicalEmail);
      const existing = entries.get(key);

      if (existing === undefined || now() >= existing.expiresAt) {
        entries.set(key, {
          attempts: 1,
          expiresAt: now() + WINDOW_MILLISECONDS,
        });
        return { allowed: true };
      }

      if (existing.attempts >= MAX_ATTEMPTS) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.expiresAt - now()) / 1000),
          ),
        };
      }

      existing.attempts += 1;
      return { allowed: true };
    },
  };
}
