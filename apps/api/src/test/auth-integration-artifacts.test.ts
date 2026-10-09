import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { createDelayedAuthResponse } from "../../../../tests/e2e/auth-integration/safe-route.ts";
import type { Request, Route } from "@playwright/test";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);

describe("credential-safe asynchronous route failures", () => {
  for (const stage of ["fetch", "fulfill", "abort"] as const)
    it(`reports ${stage} failure without rejecting the callback or retaining its error`, async () => {
      const marker = `synthetic-${randomUUID()}`;
      const delayed = createDelayedAuthResponse(new EventEmitter());
      const fetch = vi.fn<Route["fetch"]>();
      if (stage === "fetch" || stage === "abort")
        fetch.mockRejectedValue(new Error(marker));
      else
        fetch.mockResolvedValue({ status: () => 202 } as Awaited<
          ReturnType<Route["fetch"]>
        >);
      const route = {
        request: () => ({}) as Request,
        fetch,
        fulfill: vi.fn<Route["fulfill"]>().mockRejectedValue(new Error(marker)),
        abort: vi.fn<Route["abort"]>().mockRejectedValue(new Error(marker)),
      };
      delayed.release();
      await expect(delayed.handle(route)).resolves.toBeUndefined();
      if (stage === "fetch" || stage === "abort")
        await expect(delayed.status()).rejects.toThrow(
          "backend response failed; details withheld",
        );
      else expect(await delayed.status()).toBe(202);
      await expect(delayed.finish()).rejects.toThrow(
        "completion failed; details withheld",
      );
      await expect(delayed.finish()).rejects.toThrow(
        `Category: ${stage === "fulfill" ? "transport-failed" : "backend-failed"}`,
      );
      expect(JSON.stringify(delayed)).not.toContain(marker);
    });

  it("bounds missing callbacks without creating an unhandled rejection", async () => {
    vi.useFakeTimers();
    try {
      const delayed = createDelayedAuthResponse(new EventEmitter());
      const result = delayed
        .status()
        .catch((error: unknown) =>
          error instanceof Error ? error.message : "unexpected",
        );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toBe("Authentication harness operation timed out.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs negative Playwright cases and scans actual failure artifacts and process output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stockwise-auth-negative-"));
    const marker = `SYNTHETIC_SECRET_${randomUUID().replaceAll("-", "")}`;
    const testModule = require.resolve("@playwright/test");
    const routeModule = new URL(
      "../../../../tests/e2e/auth-integration/safe-route.ts",
      import.meta.url,
    );
    const reporter = new URL(
      "../../../../tests/e2e/auth-integration/safe-reporter.ts",
      import.meta.url,
    );
    const { fileURLToPath } = await import("node:url");
    await writeFile(
      join(directory, "playwright.config.ts"),
      `export default {
      testDir: ${JSON.stringify(directory)}, testMatch: 'negative.spec.ts', workers: 1, retries: 0,
      timeout: 15000, outputDir: ${JSON.stringify(join(directory, "results"))},
      reporter: ${JSON.stringify(fileURLToPath(reporter))},
      use: { trace: 'off', video: 'off', screenshot: 'off', acceptDownloads: false, serviceWorkers: 'block' }
    };`,
    );
    await writeFile(
      join(directory, "negative.spec.ts"),
      `
      import { test } from ${JSON.stringify(testModule)};
      import { createDelayedAuthResponse } from ${JSON.stringify(fileURLToPath(routeModule))};
      const marker = process.env.AUTH_NEGATIVE_MARKER;
      for (const stage of ['fetch', 'fulfill', 'abort']) test('negative route ' + stage, async ({ page }, info) => {
        const delayed = createDelayedAuthResponse(page);
        let unhandled = false;
        const listener = () => { unhandled = true; };
        process.on('unhandledRejection', listener);
        try {
          await page.setContent('<input value="' + marker + '">');
          await page.context().addCookies([{ name: 'synthetic_session', value: marker, url: 'http://localhost' }]);
          await page.route('**/negative', (route) => delayed.handle({
            request: () => route.request(),
            fetch: async () => {
              if (stage === 'fetch' || stage === 'abort') throw new Error('Cookie: ' + marker + '; Set-Cookie: ' + marker);
              return { status: () => 202 };
            },
            fulfill: async () => { throw new Error('Set-Cookie: ' + marker); },
            abort: async () => { await route.abort(); if (stage === 'abort') throw new Error('Cookie: ' + marker); }
          }));
          const navigation = page.goto('http://localhost/negative').catch(() => null);
          delayed.release();
          try { await delayed.status(); } catch { /* Sanitized failure is checked through finish. */ }
          try { await delayed.finish(); }
          catch (error) {
            if (unhandled || String(error).includes(marker) || JSON.stringify(info.errors).includes(marker))
              throw new Error('Negative regression detected a disclosure.');
            throw error;
          } finally { await navigation; }
          throw new Error('Negative regression unexpectedly passed.');
        } finally { process.off('unhandledRejection', listener); }
      });
    `,
    );
    let output: string;
    let exitCode = 0;
    try {
      const result = await execute(
        process.execPath,
        [
          require.resolve("@playwright/test/cli"),
          "test",
          "--config",
          join(directory, "playwright.config.ts"),
        ],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_NO_COPY_PROMPT: "1",
            AUTH_NEGATIVE_MARKER: marker,
          },
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 1_000_000,
        },
      );
      output = result.stdout + result.stderr;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("stdout" in error) ||
        !("stderr" in error) ||
        !("code" in error)
      ) {
        output = "";
        exitCode = -1;
      } else {
        output = String(error.stdout) + String(error.stderr);
        exitCode = Number(error.code);
      }
    }
    if (exitCode === -1)
      throw new Error("Negative Playwright runner unavailable.");
    expect(exitCode).toBe(1);
    expect(output.includes(marker)).toBe(false);
    expect(output).toContain(
      "Authentication runner: failed; test results received: 3",
    );
    expect(
      output.match(/negative route (?:fetch|fulfill|abort): failed/g),
    ).toHaveLength(3);
    let contexts = 0;
    async function scan(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const target = join(path, entry.name);
        expect(entry.name.includes(marker)).toBe(false);
        if (entry.isDirectory()) await scan(target);
        else {
          const value = await readFile(target, "utf8");
          expect(value.includes(marker)).toBe(false);
          if (entry.name === "error-context.md") {
            contexts += 1;
            expect(value).toContain(
              "Authentication route completion failed; details withheld.",
            );
            expect(value).not.toContain(
              "Negative regression detected a disclosure",
            );
          }
        }
      }
    }
    await scan(join(directory, "results"));
    expect(contexts).toBe(3);
  }, 75_000);
});
