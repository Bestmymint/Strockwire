import { Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import type { AuthenticationSessionRepository } from "./authentication-repository.ts";
import {
  createAuthenticationMiddleware,
  getTrustedAuthenticationContext,
} from "./authentication-context.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";
import { hashSessionToken } from "./session-token.ts";

const RAW_TOKEN = "A".repeat(43);
const NOW = new Date("2026-08-24T12:00:00.000Z");
const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 7 * 24 * 60 * 60 * 1000,
  idleTimeoutMilliseconds: 24 * 60 * 60 * 1000,
  secureCookie: false,
  touchIntervalMilliseconds: 15 * 60 * 1000,
};

describe("authenticated request context", () => {
  let runningServer: RunningApiServer | undefined;

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function startProtectedApplication(
    repository: AuthenticationSessionRepository,
  ) {
    const entries: unknown[] = [];
    const logger: ApiLogger = {
      error(bindings, message) {
        entries.push({ bindings, level: "error", message });
      },
      info(bindings, message) {
        entries.push({ bindings, level: "info", message });
      },
    };
    const router = Router();
    router.get(
      "/protected",
      createAuthenticationMiddleware({
        configuration,
        now: () => NOW,
        repository,
      }),
      (_request, response) => {
        const context = getTrustedAuthenticationContext(response);
        response.status(200).json({
          actor: context?.actor,
          sessionId: context?.sessionId,
        });
      },
    );
    const app = createApp({ apiRouter: router, logger });
    runningServer = await startApiServer(app, {
      host: "127.0.0.1",
      port: 0,
    });

    return {
      entries,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1/protected`,
    };
  }

  it("resolves only trusted server state and ignores forged identity headers", async () => {
    const resolveSession = vi.fn(async () => ({
      actor: {
        displayName: "Verified User",
        email: "user@example.com",
        id: "00000000-0000-4000-8000-000000000001",
      },
      sessionId: "00000000-0000-4000-8000-000000000010",
    }));
    const { url } = await startProtectedApplication({ resolveSession });

    const response = await fetch(url, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${RAW_TOKEN}`,
        "x-branch-id": "forged-branch",
        "x-organization-id": "forged-organization",
        "x-role": "OWNER",
        "x-user-id": "forged-user",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: {
        displayName: "Verified User",
        email: "user@example.com",
        id: "00000000-0000-4000-8000-000000000001",
        status: "ACTIVE",
        verified: true,
      },
      sessionId: "00000000-0000-4000-8000-000000000010",
    });
    expect(resolveSession).toHaveBeenCalledExactlyOnceWith({
      configuration,
      now: NOW,
      tokenHash: hashSessionToken(RAW_TOKEN),
    });
  });

  it.each([undefined, "short", "B".repeat(43)])(
    "denies missing, malformed, or unknown session %j",
    async (token) => {
      const resolveSession = vi.fn(async () => null);
      const { url } = await startProtectedApplication({ resolveSession });
      const response = await fetch(url, {
        headers:
          token === undefined
            ? {}
            : { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTHENTICATION_REQUIRED" },
      });
      expect(resolveSession).toHaveBeenCalledTimes(
        token !== undefined && token.length === 43 ? 1 : 0,
      );
    },
  );

  it("fails closed when session lookup or a required touch fails", async () => {
    const internalDetail = "session touch database failure with token hash";
    const { entries, url } = await startProtectedApplication({
      resolveSession: async () => {
        throw new Error(internalDetail);
      },
    });

    const response = await fetch(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${RAW_TOKEN}` },
    });
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(internalDetail);
    expect(JSON.stringify(entries)).not.toContain(internalDetail);
  });
});
