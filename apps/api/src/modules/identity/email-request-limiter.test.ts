import { describe, expect, it } from "vitest";

import { createEmailRequestLimiter } from "./email-request-limiter.ts";

describe("identity email request limiter", () => {
  it("admits three attempts and deterministically limits the fourth", () => {
    let now = 1_000;
    const limiter = createEmailRequestLimiter(() => now);

    expect(limiter.consume("user@example.com")).toEqual({ allowed: true });
    expect(limiter.consume("user@example.com")).toEqual({ allowed: true });
    expect(limiter.consume("user@example.com")).toEqual({ allowed: true });
    expect(limiter.consume("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });

    now += 1_001;
    expect(limiter.consume("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 899,
    });
  });

  it("restores allowance at fixed-window expiry and isolates canonical keys", () => {
    let now = 10_000;
    const limiter = createEmailRequestLimiter(() => now);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.consume("first@example.com")).toEqual({ allowed: true });
    }
    expect(limiter.consume("second@example.com")).toEqual({ allowed: true });

    now += 15 * 60 * 1000;
    expect(limiter.consume("first@example.com")).toEqual({ allowed: true });
  });
});
