import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import {
  chromium,
  type Browser,
  type Request,
  type Route,
} from "@playwright/test";
import { expect, it, vi } from "vitest";
import { createDelayedAuthResponse } from "../../../../tests/e2e/auth-integration/safe-route.ts";
import { assertMailboxOnlyTerminalState } from "../../../../tests/e2e/auth-integration/terminal-state.ts";

for (const cancel of [true, false])
  it(
    cancel
      ? "classifies resolved fulfillment after browser cancellation as canceled, never delivered"
      : "confirms genuine browser response and finished request as delivered",
    async () => {
      const server = createServer((request, response) => {
        response.writeHead(request.url === "/delayed" ? 202 : 200, {
          "Content-Type": "text/html",
        });
        response.end(
          request.url === "/delayed"
            ? "synthetic accepted"
            : "<p>synthetic</p>",
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Synthetic server unavailable.");
      let browser: Browser | undefined;
      try {
        browser = await chromium.launch();
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${address.port}`);
        const delayed = createDelayedAuthResponse(page);
        let responses = 0;
        let failed = 0;
        let fulfilled = 0;
        page.on("response", (response) => {
          if (response.url().endsWith("/delayed")) responses += 1;
        });
        page.on("requestfailed", (request) => {
          if (request.url().endsWith("/delayed")) failed += 1;
        });
        await page.route("**/delayed", (route) =>
          delayed.handle({
            request: () => route.request(),
            fetch: route.fetch.bind(route),
            fulfill: async (options) => {
              await route.fulfill(options);
              fulfilled += 1;
            },
            abort: route.abort.bind(route),
          }),
        );
        await page.evaluate(() => {
          const controller = new AbortController();
          Object.assign(globalThis, {
            abortSynthetic: () => controller.abort(),
          });
          void fetch("/delayed", {
            method: "POST",
            signal: controller.signal,
          }).catch(() => undefined);
        });
        expect(await delayed.status()).toBe(202);
        const waitOptions = {
          predicate: (request: Request) => request.url().endsWith("/delayed"),
          timeout: 5000,
        };
        const settlement = (
          cancel
            ? page.waitForEvent("requestfailed", waitOptions)
            : page.waitForEvent("requestfinished", waitOptions)
        ).catch(() => null);
        if (cancel) {
          await page.evaluate(() => {
            (
              globalThis as typeof globalThis & { abortSynthetic: () => void }
            ).abortSynthetic();
          });
          expect(await settlement).not.toBeNull();
        }
        await expect(delayed.finish()).resolves.toEqual({
          backendStatus: 202,
          browserOutcome: cancel ? "canceled" : "delivered",
        });
        expect(await settlement).not.toBeNull();
        expect({ responses, failed, fulfilled }).toEqual({
          responses: cancel ? 0 : 1,
          failed: cancel ? 1 : 0,
          fulfilled: 1,
        });
      } finally {
        await browser?.close();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    15000,
  );

for (const stage of [
  "missing callback",
  "fetch timeout",
  "fulfill timeout",
  "settlement timeout",
  "response without settlement",
  "mismatched response",
  "finished without response",
  "unexpected request failure",
] as const)
  it(`fails closed and removes observers for ${stage}`, async () => {
    vi.useFakeTimers();
    const events = new EventEmitter();
    const delayed = createDelayedAuthResponse(events);
    const request = {
      failure: () => ({ errorText: "synthetic transport failure" }),
    } as Request;
    const response = { status: () => 202 } as Awaited<
      ReturnType<Route["fetch"]>
    >;
    const pending = Promise.withResolvers<void>();
    const callback =
      stage === "missing callback"
        ? Promise.resolve()
        : delayed.handle({
            request: () => request,
            fetch: async () => {
              if (stage === "fetch timeout") await pending.promise;
              return response;
            },
            fulfill: async () => {
              if (stage === "fulfill timeout") await pending.promise;
              if (stage === "response without settlement")
                events.emit("response", {
                  request: () => request,
                  status: () => 202,
                });
              if (stage === "finished without response")
                events.emit("requestfinished", request);
              if (stage === "mismatched response") {
                events.emit("response", {
                  request: () => request,
                  status: () => 200,
                });
                events.emit("requestfinished", request);
              }
              if (stage === "unexpected request failure")
                events.emit("requestfailed", request);
            },
            abort: async () => undefined,
          });
    const completion = delayed
      .finish()
      .catch((error: unknown) =>
        error instanceof Error ? error.message : "unexpected",
      );
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await completion;
      expect(typeof error).toBe("string");
      expect(error).not.toContain("synthetic transport failure");
      expect(error).toMatch(/timed out|completion failed/);
      expect(events.eventNames()).toEqual([]);
      if (stage !== "missing callback" && stage !== "fetch timeout")
        expect(await delayed.status()).toBe(202);
    } finally {
      pending.resolve();
      await callback;
      vi.useRealTimers();
    }
  });

it("reproduces the former consumed-challenge false positive and rejects it with terminal assertions", async () => {
  const findChallenge = vi.fn().mockResolvedValue({
    consumedAt: new Date("2026-01-01T00:00:00Z"),
    failedOtpAttempts: 1,
  });
  const challenge = await findChallenge();
  // The previous terminal check looked only at this count.
  expect(challenge.failedOtpAttempts).toBe(1);
  expect(() =>
    assertMailboxOnlyTerminalState(challenge, { emailVerifiedAt: null }, 0),
  ).toThrow("challenge was consumed");
});

it("accepts only an unconsumed, unverified mailbox-only state with one failure and no session", async () => {
  const findChallenge = vi
    .fn()
    .mockResolvedValue({ consumedAt: null, failedOtpAttempts: 1 });
  const findUser = vi.fn().mockResolvedValue({ emailVerifiedAt: null });
  const countSessions = vi.fn().mockResolvedValue(0);
  const challenge = await findChallenge();
  const user = await findUser();
  const sessions = await countSessions();
  expect(() =>
    assertMailboxOnlyTerminalState(challenge, user, sessions),
  ).not.toThrow();
});

for (const state of [
  "verified user",
  "zero failures",
  "two failures",
  "null failures",
  "session authority",
] as const)
  it(`rejects mailbox-only terminal state with ${state}`, async () => {
    const findChallenge = vi.fn().mockResolvedValue({
      consumedAt: null,
      failedOtpAttempts:
        state === "zero failures"
          ? 0
          : state === "two failures"
            ? 2
            : state === "null failures"
              ? null
              : 1,
    });
    const findUser = vi.fn().mockResolvedValue({
      emailVerifiedAt:
        state === "verified user" ? new Date("2026-01-01T00:00:00Z") : null,
    });
    const countSessions = vi
      .fn()
      .mockResolvedValue(state === "session authority" ? 1 : 0);
    const challenge = await findChallenge();
    const user = await findUser();
    const sessions = await countSessions();
    expect(() =>
      assertMailboxOnlyTerminalState(challenge, user, sessions),
    ).toThrow();
  });
