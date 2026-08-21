import { createServer, type Server } from "node:http";

import type { Express } from "express";

import type { ApiLogger } from "./logger.ts";

export interface ApiServerAddress {
  host: string;
  port: number;
}

export interface RunningApiServer {
  address: ApiServerAddress;
  stop(): Promise<void>;
}

interface StartApiServerOptions {
  host: string;
  port: number;
}

export type ShutdownSignal = "SIGINT" | "SIGTERM";

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function startApiServer(
  app: Express,
  { host, port }: StartApiServerOptions,
): Promise<RunningApiServer> {
  const server = createServer(app);

  return new Promise((resolve, reject) => {
    const handleStartupError = (error: Error) => {
      reject(error);
    };

    server.once("error", handleStartupError);
    server.listen(port, host, () => {
      server.off("error", handleStartupError);

      const address = server.address();
      if (address === null || typeof address === "string") {
        void closeServer(server);
        reject(new Error("The API server did not expose a TCP address."));
        return;
      }

      let stopPromise: Promise<void> | undefined;

      resolve({
        address: { host: address.address, port: address.port },
        stop() {
          stopPromise ??= closeServer(server);
          return stopPromise;
        },
      });
    });
  });
}

export function createShutdownHandler(
  runningServer: RunningApiServer,
  logger: ApiLogger,
): (signal: ShutdownSignal) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return (signal) => {
    shutdownPromise ??= (async () => {
      logger.info({ signal }, "shutdown started");

      try {
        await runningServer.stop();
        logger.info({ signal }, "shutdown completed");
      } catch (error) {
        logger.error(
          {
            errorName: error instanceof Error ? error.name : "UnknownError",
            signal,
          },
          "shutdown failed",
        );
        throw error;
      }
    })();

    return shutdownPromise;
  };
}
