import { describe, expect, it } from "vitest";

import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from "./session-cookie.ts";

const RAW_TOKEN = "A".repeat(43);

describe("session cookie boundary", () => {
  it("serializes the accepted local-development cookie contract", () => {
    expect(serializeSessionCookie(RAW_TOKEN, false)).toBe(
      `${SESSION_COOKIE_NAME}=${RAW_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
    );
  });

  it("adds Secure only in production cookie mode", () => {
    const cookie = serializeSessionCookie(RAW_TOKEN, true);

    expect(cookie).toContain("; Secure");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("__Host-");
  });

  it("clears the cookie with matching host-only security attributes", () => {
    const local = serializeClearedSessionCookie(false);
    const production = serializeClearedSessionCookie(true);

    expect(local).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(local).toContain("Path=/");
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).toContain("Max-Age=0");
    expect(local).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(local).not.toContain("Secure");
    expect(local).not.toContain("Domain=");
    expect(production).toContain("Secure");
  });

  it("reads one valid StockWise cookie while ignoring unrelated cookies", () => {
    expect(
      readSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${RAW_TOKEN}`),
    ).toBe(RAW_TOKEN);
  });

  it.each([
    undefined,
    `${SESSION_COOKIE_NAME}=short`,
    `${SESSION_COOKIE_NAME}=%ZZ`,
    `${SESSION_COOKIE_NAME}=${RAW_TOKEN}; ${SESSION_COOKIE_NAME}=${RAW_TOKEN}`,
  ])("fails closed for missing, malformed, or duplicate cookies", (header) => {
    expect(readSessionCookie(header)).toBeNull();
  });
});
