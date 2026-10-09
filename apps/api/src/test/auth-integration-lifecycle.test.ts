import { describe, expect, it, vi } from "vitest";
import {
  authBounded,
  createAuthCleanup,
} from "./auth-integration-lifecycle.ts";
import { createPrivateVerificationMailbox } from "./auth-integration-mailbox.ts";
import { randomUUID } from "node:crypto";

describe("bounded independent authentication cleanup", () => {
  const stages = [
    "database",
    "mailbox",
    "prisma",
    "runtime",
    "next",
    "api",
    "readiness",
  ];
  for (const failedAt of stages)
    it(`unwinds acquired resources after ${failedAt} startup failure`, async () => {
      const cleanup = createAuthCleanup();
      const released: string[] = [];
      for (const stage of stages) {
        if (stage === failedAt) break;
        cleanup.add(() => {
          released.push(stage);
        });
      }
      await cleanup.stop();
      expect(released).toEqual(
        stages.slice(0, stages.indexOf(failedAt)).toReversed(),
      );
      await cleanup.stop();
      expect(new Set(released).size).toBe(released.length);
    });
  for (const failedAt of stages.slice(0, -1))
    it(`continues every other step after ${failedAt} teardown fails`, async () => {
      const cleanup = createAuthCleanup();
      const released: string[] = [];
      for (const stage of stages.slice(0, -1))
        cleanup.add(() => {
          released.push(stage);
          if (stage === failedAt)
            throw new Error("SYNTHETIC_PRIVATE_CLEANUP_MARKER");
        });
      await expect(cleanup.stop()).rejects.toThrow("cleanup incomplete");
      expect(released).toEqual(stages.slice(0, -1).toReversed());
    });
  it("clears private mail and cancels waiters despite an earlier failure", async () => {
    const cleanup = createAuthCleanup();
    const mailbox = createPrivateVerificationMailbox();
    const email = `t02a-${randomUUID()}@example.invalid`;
    mailbox.allowAccount(email);
    const waiting = mailbox.next(email).catch(() => "cleared");
    cleanup.add(() => mailbox.clear());
    cleanup.add(() => {
      throw new Error("SYNTHETIC_PRIVATE_PROCESS_MARKER");
    });
    await expect(cleanup.stop()).rejects.toThrow("cleanup incomplete");
    expect(await waiting).toBe("cleared");
    await expect(mailbox.next(email)).rejects.toThrow("wait refused");
  });
  it("bounds hung shutdown and absorbs a later rejection", async () => {
    vi.useFakeTimers();
    try {
      const pending = Promise.withResolvers<void>();
      const result = authBounded(pending.promise, 20).catch((error: unknown) =>
        error instanceof Error ? error.message : "unexpected",
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(await result).toBe("Authentication harness operation timed out.");
      pending.reject(new Error("SYNTHETIC_LATE_PRIVATE_MARKER"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
