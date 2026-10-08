import { Router } from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.ts";
import type { ApiLogger } from "./logger.ts";
import { startApiServer, type RunningApiServer } from "./server.ts";

interface LogEntry {
  bindings: Record<string, unknown>;
  level: "error" | "info";
  message: string;
}

function createCapturingLogger(): {
  entries: LogEntry[];
  logger: ApiLogger;
} {
  const entries: LogEntry[] = [];

  return {
    entries,
    logger: {
      error(bindings, message) {
        entries.push({ bindings, level: "error", message });
      },
      info(bindings, message) {
        entries.push({ bindings, level: "info", message });
      },
    },
  };
}

describe("Express API application", () => {
  let runningServer: RunningApiServer | undefined;

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function startApplication({
    apiRouter,
    readinessCheck,
  }: {
    apiRouter?: Router;
    readinessCheck?: () => boolean | Promise<boolean>;
  } = {}) {
    const captured = createCapturingLogger();
    const app = createApp({
      apiRouter,
      logger: captured.logger,
      readinessCheck,
    });
    runningServer = await startApiServer(app, {
      host: "127.0.0.1",
      port: 0,
    });

    return {
      ...captured,
      baseUrl: `http://${runningServer.address.host}:${runningServer.address.port}`,
    };
  }

  it.each(["/api/v1/not-implemented", "/outside-api"])(
    "returns the safe error envelope for an unknown route at %s",
    async (path) => {
      const { baseUrl } = await startApplication();
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.json();
      const requestId = response.headers.get("x-request-id");

      expect(response.status).toBe(404);
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(body).toEqual({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "The requested resource was not found.",
          requestId,
        },
      });
      expect(response.headers.get("x-powered-by")).toBeNull();
    },
  );

  it("returns a deterministic liveness response without dependency details", async () => {
    const { baseUrl } = await startApplication();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("does not permit direct cross-origin browser access to operational probes", async () => {
    const { baseUrl } = await startApplication();
    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns ready when required dependencies are ready", async () => {
    const { baseUrl } = await startApplication({ readinessCheck: () => true });
    const response = await fetch(`${baseUrl}/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("returns a safe unavailable response when a required dependency is unready", async () => {
    const dependencyDetail = "DATABASE_URL=must-not-leak";
    const { baseUrl, entries } = await startApplication({
      readinessCheck: async () => {
        throw new Error(dependencyDetail);
      },
    });
    const response = await fetch(`${baseUrl}/ready`);
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).not.toContain(dependencyDetail);
    expect(JSON.parse(responseText)).toEqual({ status: "not_ready" });
    expect(JSON.stringify(entries)).not.toContain(dependencyDetail);
  });

  it("maps malformed JSON to a request-correlated validation error", async () => {
    const { baseUrl } = await startApplication();
    const response = await fetch(`${baseUrl}/api/v1/not-implemented`, {
      body: '{"invalid":',
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request body is not valid JSON.",
        requestId,
      },
    });
  });

  it("rejects an oversized JSON body without treating it as a server failure", async () => {
    const { baseUrl, entries } = await startApplication();
    const response = await fetch(`${baseUrl}/api/v1/not-implemented`, {
      body: JSON.stringify({ value: "x".repeat(110 * 1024) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request body is too large.",
        requestId: response.headers.get("x-request-id"),
      },
    });
    expect(entries.some((entry) => entry.level === "error")).toBe(false);
  });

  it.each([
    { kind: "malformed JSON", body: '{"code":', status: 400 },
    {
      kind: "oversized JSON",
      body: JSON.stringify({ value: "x".repeat(110 * 1024) }),
      status: 413,
    },
  ])(
    "protects authentication parser errors for $kind",
    async ({ body, status }) => {
      const { baseUrl } = await startApplication();
      for (const path of [
        "register",
        "login",
        "verification-password-proof",
        "verification-resend",
        "verify-email-code",
        "verify-email",
      ]) {
        const response = await fetch(`${baseUrl}/api/v1/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(await response.json()).toMatchObject({
          error: { code: "VALIDATION_ERROR" },
        });
      }
    },
  );

  it("hides unexpected error details from responses and logs", async () => {
    const apiRouter = Router();
    apiRouter.get("/explode", () => {
      throw new Error("DATABASE_PASSWORD=must-not-leak");
    });

    const { baseUrl, entries } = await startApplication({ apiRouter });
    const response = await fetch(`${baseUrl}/api/v1/explode`);
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain("DATABASE_PASSWORD");
    expect(responseText).not.toContain("must-not-leak");
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: response.headers.get("x-request-id"),
      },
    });

    const errorEntry = entries.find((entry) => entry.level === "error");
    expect(errorEntry).toEqual({
      bindings: {
        errorName: "Error",
        requestId: response.headers.get("x-request-id"),
      },
      level: "error",
      message: "request failed",
    });
    expect(JSON.stringify(entries)).not.toContain("must-not-leak");
  });

  it("logs safe structured request completion data without the query string", async () => {
    const { baseUrl, entries } = await startApplication();
    const response = await fetch(
      `${baseUrl}/api/v1/not-implemented?token=must-not-be-logged`,
    );
    await response.text();

    const completionEntry = entries.find(
      (entry) => entry.message === "request completed",
    );
    expect(completionEntry).toEqual({
      bindings: {
        durationMilliseconds: expect.any(Number),
        method: "GET",
        path: "/api/v1/not-implemented",
        requestId: response.headers.get("x-request-id"),
        statusCode: 404,
      },
      level: "info",
      message: "request completed",
    });
    expect(JSON.stringify(entries)).not.toContain("must-not-be-logged");
  });
});
