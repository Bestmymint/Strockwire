import { createHash, randomBytes } from "node:crypto";

const ONE_TIME_TOKEN_BYTES = 32;
const ONE_TIME_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface OneTimeToken {
  rawToken: string;
  tokenHash: string;
}

export interface OneTimeTokenProvider {
  generate(): OneTimeToken;
}

export function isOneTimeToken(value: string): boolean {
  return ONE_TIME_TOKEN_PATTERN.test(value);
}

export function hashOneTimeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateOneTimeToken(): OneTimeToken {
  const rawToken = randomBytes(ONE_TIME_TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashOneTimeToken(rawToken) };
}

export const secureOneTimeTokenProvider: OneTimeTokenProvider = {
  generate: generateOneTimeToken,
};
