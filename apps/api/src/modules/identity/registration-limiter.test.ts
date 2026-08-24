import { describe, expect, it } from "vitest";

import { createRegistrationLimiter } from "./registration-limiter.ts";

describe("registration limiter", () => {
  it("permits five attempts and returns the fixed-window Retry-After on the sixth", () => {
    let currentTime = 1_000_000;
    const limiter = createRegistrationLimiter(() => currentTime);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(limiter.consume("user@example.com")).toEqual({ allowed: true });
    }

    expect(limiter.consume("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });

    currentTime += 1_001;
    expect(limiter.consume("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 899,
    });
  });

  it("restores allowance when the window expires", () => {
    let currentTime = 10_000;
    const limiter = createRegistrationLimiter(() => currentTime);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      limiter.consume("user@example.com");
    }

    currentTime += 15 * 60 * 1000;

    expect(limiter.consume("user@example.com")).toEqual({ allowed: true });
  });

  it("tracks different canonical emails independently", () => {
    const limiter = createRegistrationLimiter(() => 0);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      limiter.consume("first@example.com");
    }

    expect(limiter.consume("first@example.com").allowed).toBe(false);
    expect(limiter.consume("second@example.com")).toEqual({ allowed: true });
  });
});
