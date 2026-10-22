import { createServer } from "node:http";

import express from "express";
import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import {
  createBetterAuthNative,
  denyAllNativeAuthRoutes,
} from "./better-auth-native.ts";

function createNoDatabasePrisma(): {
  prisma: PrismaClient;
  reads: () => number;
} {
  let reads = 0;
  const prisma = new Proxy(
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString: "postgresql://unused:unused@127.0.0.1:1/unused_test",
      }),
    }),
    {
      get: () =>
        new Proxy(
          {},
          {
            get: (_model, methodName) => {
              if (
                typeof methodName === "string" &&
                /^(find|create|update|delete|count|upsert|aggregate|groupBy)/.test(
                  methodName,
                )
              ) {
                return async () => {
                  reads += 1;
                  throw new Error("Database access is forbidden in this test");
                };
              }
              return undefined;
            },
          },
        ),
    },
  );

  return { prisma, reads: () => reads };
}

function nativeAuth() {
  const database = createNoDatabasePrisma();
  const auth = createBetterAuthNative({
    prisma: database.prisma,
    secret: "test-only-secret-not-a-credential",
    publicWebOrigin: "https://web.example.test",
    secureCookie: true,
  });
  return { auth, database };
}

describe("disabled Better Auth native boundary", () => {
  it.each([
    ["POST", "/api/v1/auth/sign-up/email"],
    ["POST", "/api/v1/auth/sign-in/email"],
    ["GET", "/api/v1/auth/sign-out"],
    ["POST", "/api/v1/auth/reset-password"],
    ["POST", "/api/v1/auth/sign-up%2Femail"],
    ["POST", "/api/v1/auth/../auth/sign-up/email"],
    ["PUT", "/api/v1/auth/link-social"],
    ["GET", "/api/v1/auth/email-otp/verify-email"],
  ])(
    "denies native HTTP %s %s without database reads",
    async (method, path) => {
      const { auth, database } = nativeAuth();
      const response = await auth.handler(
        new Request(`https://api.example.test${path}`, { method }),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain(
        "test-only-secret-not-a-credential",
      );
      expect(database.reads()).toBe(0);
    },
  );

  it("keeps internal read-only session lookup available without a cookie", async () => {
    const { auth, database } = nativeAuth();
    expect(
      await auth.api.getSession({
        headers: new Headers(),
        query: { disableCookieCache: true, disableRefresh: true },
      }),
    ).toBeNull();
    expect(database.reads()).toBe(0);
  });

  it("denies requests through the Express handler without invoking native auth", async () => {
    const { database } = nativeAuth();
    const app = express();
    app.use("/api/v1/auth", denyAllNativeAuthRoutes);
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral TCP listener");
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/auth/sign-up/email?alias=1`,
        { method: "PATCH" },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Authentication route unavailable",
      });
      expect(database.reads()).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
