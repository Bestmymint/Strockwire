import { describe, expect, it } from "vitest";

import {
  generateOneTimeToken,
  hashOneTimeToken,
  isOneTimeToken,
} from "./one-time-token.ts";

describe("one-time identity tokens", () => {
  it("generates independent 256-bit opaque tokens with deterministic hashes", () => {
    const first = generateOneTimeToken();
    const second = generateOneTimeToken();

    expect(isOneTimeToken(first.rawToken)).toBe(true);
    expect(isOneTimeToken(second.rawToken)).toBe(true);
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).toBe(hashOneTimeToken(first.rawToken));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.rawToken);
  });

  it.each(["", "short", "A".repeat(42), "A".repeat(44), "!".repeat(43)])(
    "rejects malformed token %s",
    (token) => {
      expect(isOneTimeToken(token)).toBe(false);
    },
  );
});
