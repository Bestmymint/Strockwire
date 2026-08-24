import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "./session-token.ts";

describe("session token boundary", () => {
  it("generates independent 256-bit base64url tokens and SHA-256 lookup hashes", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first.rawToken).toHaveLength(43);
    expect(isSessionToken(first.rawToken)).toBe(true);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).toBe(hashSessionToken(first.rawToken));
    expect(first.tokenHash).not.toBe(first.rawToken);
    expect(second.rawToken).not.toBe(first.rawToken);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it.each(["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}+`])(
    "rejects malformed token %j",
    (token) => {
      expect(isSessionToken(token)).toBe(false);
    },
  );
});
