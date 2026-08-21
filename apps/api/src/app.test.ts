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

  async function startApplication(apiRouter?: Router) {
    const captured = createCapturingLogger();
    const app = createApp(
      apiRouter === undefined
        ? { logger: captured.logger }
        : { apiRouter, logger: captured.logger },
    );
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

  it("hides unexpected error details from responses and logs", async () => {
    const apiRouter = Router();
    apiRouter.get("/explode", () => {
      throw new Error("DATABASE_PASSWORD=must-not-leak");
    });

    const { baseUrl, entries } = await startApplication(apiRouter);
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
