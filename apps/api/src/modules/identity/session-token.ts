import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionToken {
  rawToken: string;
  tokenHash: string;
}

export interface SessionTokenProvider {
  generate(): SessionToken;
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateSessionToken(): SessionToken {
  const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashSessionToken(rawToken) };
}

export const secureSessionTokenProvider: SessionTokenProvider = {
  generate: generateSessionToken,
};
