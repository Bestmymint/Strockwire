import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHarness } from "../../../../tests/e2e/auth-integration/harness-runtime.ts";

// Only scaffold acquisition/teardown is exercised. These doubles prove no Argon2 equivalence.
const state = vi.hoisted(() => ({
  fail: "",
  closed: [] as string[],
  signals: [] as string[],
}));
function fail(stage: string) {
  if (state.fail === stage) throw new Error("SYNTHETIC_PRIVATE_STARTUP_MARKER");
}
vi.mock("./auth-integration-database.ts", () => ({
  requireFreeLoopbackPort: vi.fn(async () => undefined),
  createOwnedAuthDatabase: vi.fn(async () => {
    fail("database");
    return {
      environment: {
        TEST_DATABASE_URL:
          "postgresql://synthetic:synthetic@127.0.0.1:1/isolated_auth_test",
      },
      cleanup: async () => {
        state.closed.push("database");
        fail("database-stop");
      },
    };
  }),
}));
vi.mock("./auth-integration-mailbox.ts", () => ({
  createPrivateVerificationMailbox: () => {
    fail("mailbox");
    return {
      provider: {},
      clear: () => {
        state.closed.push("mailbox");
        fail("mailbox-stop");
      },
    };
  },
}));
vi.mock("../prisma/client.ts", () => ({
  createPrismaClient: () => {
    fail("prisma");
    return {
      $disconnect: async () => {
        state.closed.push("prisma");
        fail("prisma-stop");
      },
    };
  },
}));
vi.mock("../environment.ts", () => ({
  loadApiEnvironment: () => {
    fail("environment");
    return {};
  },
}));
vi.mock("../modules/identity/authentication-runtime.ts", () => ({
  createAuthenticationRuntime: () => {
    fail("runtime");
    return {
      router: {
        use: () => {
          fail("router");
        },
      },
      drain: async () => {
        state.closed.push("runtime");
        fail("runtime-stop");
      },
    };
  },
}));
vi.mock("../modules/organizations/branch-repository.ts", () => ({
  createPrismaBranchRepository: () => ({}),
}));
vi.mock("../modules/organizations/branch-service.ts", () => ({
  createBranchService: () => ({}),
}));
vi.mock("../modules/organizations/branch-router.ts", () => ({
  createBranchRouter: () => ({}),
}));
vi.mock("../app.ts", () => ({ createApp: () => ({}) }));
vi.mock("../server.ts", () => ({
  startApiServer: async () => {
    fail("api");
    return {
      stop: async () => {
        state.closed.push("api");
        fail("api-stop");
      },
    };
  },
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    existsSync: (path: string) =>
      path.endsWith("/.next/BUILD_ID") ||
      (state.fail === "preflight" && path.endsWith("/.env")),
    readFileSync: () => "http://127.0.0.1:3103/api/v1/",
  };
});
vi.mock("node:child_process", () => ({
  spawn: () => {
    fail("next");
    const child = new EventEmitter();
    if (state.fail === "readiness")
      queueMicrotask(() =>
        child.emit("error", new Error("SYNTHETIC_PRIVATE_CHILD_MARKER")),
      );
    return Object.assign(child, {
      exitCode: null,
      kill(signal?: string) {
        state.closed.push("next");
        state.signals.push(signal ?? "SIGTERM");
        fail("next-stop");
        if (state.fail === "next-hang") return true;
        child.emit("exit");
        return true;
      },
    });
  },
}));

describe("actual harness startup scaffold with fault-injection constructors", () => {
  beforeEach(() => {
    state.fail = "";
    state.closed = [];
    state.signals = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const failures: Record<string, string[]> = {
    preflight: [],
    database: [],
    mailbox: ["database"],
    prisma: ["mailbox", "database"],
    environment: ["prisma", "mailbox", "database"],
    runtime: ["prisma", "mailbox", "database"],
    router: ["runtime", "prisma", "mailbox", "database"],
    next: ["runtime", "prisma", "mailbox", "database"],
    api: ["next", "runtime", "prisma", "mailbox", "database"],
    readiness: ["api", "next", "runtime", "prisma", "mailbox", "database"],
  };
  for (const [stage, expected] of Object.entries(failures))
    it(`releases acquired resources when ${stage} fails`, async () => {
      state.fail = stage;
      await expect(startHarness()).rejects.toThrow(
        stage === "preflight" ? "isolated checkout" : "startup failed",
      );
      expect(state.closed).toEqual(expected);
    });
  it("closes every real scaffold acquisition once after successful startup", async () => {
    // BUILD_ID is required; this doubles only the safe preflight, not a real web build.
    const harness = await startHarness();
    await harness.stop();
    await harness.stop();
    expect(state.closed).toEqual([
      "api",
      "next",
      "runtime",
      "prisma",
      "mailbox",
      "database",
    ]);
  });
  for (const stage of [
    "database",
    "mailbox",
    "prisma",
    "runtime",
    "next",
    "api",
  ]) {
    it(`attempts all other scaffold cleanup after ${stage} shutdown fails`, async () => {
      const harness = await startHarness();
      state.fail = `${stage}-stop`;
      await expect(harness.stop()).rejects.toThrow("cleanup incomplete");
      expect(state.closed).toEqual([
        "api",
        "next",
        "runtime",
        "prisma",
        "mailbox",
        "database",
      ]);
    });
  }
  it("bounds a child that ignores both signals and still clears the mailbox and database", async () => {
    const harness = await startHarness();
    state.fail = "next-hang";
    vi.useFakeTimers();
    const stopped = harness
      .stop()
      .catch((error: unknown) =>
        error instanceof Error ? error.message : "unexpected",
      );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await stopped).toBe(
      "Authentication harness cleanup incomplete; review owned resources.",
    );
    expect(state.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(state.closed).toEqual([
      "api",
      "next",
      "next",
      "runtime",
      "prisma",
      "mailbox",
      "database",
    ]);
  });
});
