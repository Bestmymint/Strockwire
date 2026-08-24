import { createHash } from "node:crypto";

const MAX_ATTEMPTS = 5;
const WINDOW_MILLISECONDS = 15 * 60 * 1000;

interface RegistrationLimitEntry {
  attempts: number;
  expiresAt: number;
}

export type RegistrationLimitResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RegistrationLimiter {
  consume(canonicalEmail: string): RegistrationLimitResult;
}

function limiterKey(canonicalEmail: string): string {
  return createHash("sha256").update(canonicalEmail).digest("base64url");
}

export function createRegistrationLimiter(
  now: () => number = Date.now,
): RegistrationLimiter {
  const entries = new Map<string, RegistrationLimitEntry>();
  let nextCleanupAt = now() + WINDOW_MILLISECONDS;

  function removeExpiredEntries(currentTime: number): void {
    if (currentTime < nextCleanupAt) {
      return;
    }

    for (const [key, entry] of entries) {
      if (currentTime >= entry.expiresAt) {
        entries.delete(key);
      }
    }

    nextCleanupAt = currentTime + WINDOW_MILLISECONDS;
  }

  return {
    consume(canonicalEmail) {
      const currentTime = now();
      removeExpiredEntries(currentTime);

      const key = limiterKey(canonicalEmail);
      const existing = entries.get(key);

      if (existing === undefined || currentTime >= existing.expiresAt) {
        entries.set(key, {
          attempts: 1,
          expiresAt: currentTime + WINDOW_MILLISECONDS,
        });
        return { allowed: true };
      }

      if (existing.attempts >= MAX_ATTEMPTS) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.expiresAt - currentTime) / 1000),
          ),
        };
      }

      existing.attempts += 1;
      return { allowed: true };
    },
  };
}
