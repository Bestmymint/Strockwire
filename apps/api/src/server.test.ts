import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.ts";
import type { ApiLogger } from "./logger.ts";
import {
  createShutdownHandler,
  startApiServer,
  type RunningApiServer,
} from "./server.ts";

function createSilentLogger(): ApiLogger {
  return {
    error() {},
    info() {},
  };
}

describe("API server lifecycle", () => {
  it("listens on the requested interface and stops cleanly", async () => {
    const logger = createSilentLogger();
    const runningServer = await startApiServer(createApp({ logger }), {
      host: "127.0.0.1",
      port: 0,
    });
    const url = `http://${runningServer.address.host}:${runningServer.address.port}/api/v1`;

    expect((await fetch(url)).status).toBe(404);
    await runningServer.stop();
    await expect(fetch(url)).rejects.toThrow();
  });

  it("coalesces repeated shutdown signals into one clean stop", async () => {
    const stop = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);
    const entries: string[] = [];
    const runningServer: RunningApiServer = {
      address: { host: "127.0.0.1", port: 0 },
      stop,
    };
    const logger: ApiLogger = {
      error(_bindings, message) {
        entries.push(message);
      },
      info(_bindings, message) {
        entries.push(message);
      },
    };
    const shutdown = createShutdownHandler(runningServer, logger, cleanup);

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(stop).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(entries).toEqual(["shutdown started", "shutdown completed"]);
  });

  it("reports shutdown failure without logging the error message", async () => {
    const secret = "DATABASE_PASSWORD=must-not-leak";
    const entries: Array<{
      bindings: Record<string, unknown>;
      message: string;
    }> = [];
    const runningServer: RunningApiServer = {
      address: { host: "127.0.0.1", port: 0 },
      stop: async () => {
        throw new Error(secret);
      },
    };
    const logger: ApiLogger = {
      error(bindings, message) {
        entries.push({ bindings, message });
      },
      info(bindings, message) {
        entries.push({ bindings, message });
      },
    };
    const shutdown = createShutdownHandler(runningServer, logger);

    await expect(shutdown("SIGTERM")).rejects.toThrow(secret);
    expect(entries.at(-1)).toEqual({
      bindings: { errorName: "Error", signal: "SIGTERM" },
      message: "shutdown failed",
    });
    expect(JSON.stringify(entries)).not.toContain(secret);
  });
});
