import { z } from "zod";

const CONTINUATION_STORAGE_KEY = "stockwise_verification_continuation";
const CONTINUATION_VERSION = 1;
const CONTINUATION_MAX_AGE_MS = 30 * 60 * 1000;

export interface VerificationContinuation {
  version: 1;
  canonicalEmail: string;
  challengeId: string | null;
  savedAt: number;
}

export type VerificationContinuationSource =
  "storage" | "unavailable" | "expired" | "malformed";

export interface VerificationContinuationState {
  continuation: VerificationContinuation | null;
  source: VerificationContinuationSource;
}

const continuationSchema = z
  .object({
    version: z.literal(CONTINUATION_VERSION),
    canonicalEmail: z
      .string()
      .email()
      .max(320)
      .refine((email) => email === email.trim().toLowerCase()),
    challengeId: z.uuid().nullable(),
    savedAt: z.number().int().nonnegative().safe(),
  })
  .strict();

function parseContinuation(
  raw: string | null,
): VerificationContinuation | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = continuationSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  return {
    version: CONTINUATION_VERSION,
    canonicalEmail: result.data.canonicalEmail,
    challengeId: result.data.challengeId,
    savedAt: result.data.savedAt,
  };
}

export function loadVerificationContinuation(
  storage: Storage | null,
  now: number = Date.now(),
): VerificationContinuationState {
  if (storage === null) {
    return { continuation: null, source: "unavailable" };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(CONTINUATION_STORAGE_KEY);
  } catch {
    return { continuation: null, source: "unavailable" };
  }

  const continuation = parseContinuation(raw);
  if (continuation === null) {
    clearVerificationContinuation(storage);
    return {
      continuation: null,
      source: raw === null ? "unavailable" : "malformed",
    };
  }

  if (
    continuation.savedAt > now ||
    now - continuation.savedAt >= CONTINUATION_MAX_AGE_MS
  ) {
    clearVerificationContinuation(storage);
    return { continuation: null, source: "expired" };
  }

  return { continuation, source: "storage" };
}

export function saveVerificationContinuation(
  storage: Storage | null,
  continuation: VerificationContinuation,
  now: number = Date.now(),
): boolean {
  if (storage === null) {
    return false;
  }

  const result = continuationSchema.safeParse(continuation);
  if (
    !result.success ||
    result.data.savedAt > now ||
    now - result.data.savedAt >= CONTINUATION_MAX_AGE_MS
  ) {
    clearVerificationContinuation(storage);
    return false;
  }
  try {
    // Explicit allowlist: never serialize an input object with extra credentials.
    storage.setItem(
      CONTINUATION_STORAGE_KEY,
      JSON.stringify({
        version: result.data.version,
        canonicalEmail: result.data.canonicalEmail,
        challengeId: result.data.challengeId,
        savedAt: result.data.savedAt,
      }),
    );
    return true;
  } catch {
    clearVerificationContinuation(storage);
    return false;
  }
}

export function clearVerificationContinuation(storage: Storage | null): void {
  if (storage === null) {
    return;
  }

  try {
    storage.removeItem(CONTINUATION_STORAGE_KEY);
  } catch {
    // Storage is best-effort; nothing else to do.
  }
}
