import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import { createNativePasswordResetLimiter } from "./native-password-reset-limiter.ts";

const environment = loadTestDatabaseEnvironment();
const firstPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: environment.TEST_DATABASE_URL,
    idleTimeoutMillis: 0,
  }),
});
const secondPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: environment.TEST_DATABASE_URL,
    idleTimeoutMillis: 0,
  }),
});
const firstLimiter = createNativePasswordResetLimiter(firstPrisma);
const secondLimiter = createNativePasswordResetLimiter(secondPrisma);
const testEmail = "native-password-reset-quota.integration@example.test";
const keyHash = createHash("sha256").update(testEmail).digest("hex");

async function clearQuota(): Promise<void> {
  await firstPrisma.$executeRaw`DELETE FROM native_password_reset_quotas
    WHERE key_hash = ${keyHash}`;
}

describe("native password reset durable quota", () => {
  beforeEach(clearQuota);
  afterAll(async () => {
    await clearQuota();
    await Promise.all([firstPrisma.$disconnect(), secondPrisma.$disconnect()]);
  });

  it("shares three admissions across clients and resets after the database window", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? firstLimiter : secondLimiter).consume(testEmail),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(
      results
        .filter((result) => !result.allowed)
        .every(
          (result) =>
            !result.allowed &&
            result.retryAfterSeconds >= 1 &&
            result.retryAfterSeconds <= 900,
        ),
    ).toBe(true);

    await firstPrisma.$executeRaw`UPDATE native_password_reset_quotas
      SET window_started_at = clock_timestamp() - INTERVAL '16 minutes'
      WHERE key_hash = ${keyHash}`;
    expect(await secondLimiter.consume(testEmail)).toEqual({ allowed: true });

    const rows = await firstPrisma.$queryRaw<
      Array<{ attempts: number; key_hash: string }>
    >`SELECT attempts, key_hash FROM native_password_reset_quotas
      WHERE key_hash = ${keyHash}`;
    expect(rows).toEqual([{ attempts: 1, key_hash: keyHash }]);
  });

  it("retains an exhausted budget in a fresh Node process", async () => {
    for (let index = 0; index < 3; index += 1)
      expect(await firstLimiter.consume(testEmail)).toEqual({ allowed: true });
    const clientUrl = new URL(
      "../../generated/prisma/client.ts",
      import.meta.url,
    ).href;
    const guardUrl = new URL(
      "../../test/database-environment.ts",
      import.meta.url,
    ).href;
    const limiterUrl = new URL(
      "./native-password-reset-limiter.ts",
      import.meta.url,
    ).href;
    const adapterUrl = import.meta.resolve("@prisma/adapter-pg");
    const source = `
      import { PrismaClient } from ${JSON.stringify(clientUrl)};
      import { PrismaPg } from ${JSON.stringify(adapterUrl)};
      import { loadTestDatabaseEnvironment } from ${JSON.stringify(guardUrl)};
      import { createNativePasswordResetLimiter } from ${JSON.stringify(limiterUrl)};
      const prisma = new PrismaClient({ adapter: new PrismaPg({
        connectionString: loadTestDatabaseEnvironment().TEST_DATABASE_URL
      }) });
      try {
        console.log(JSON.stringify(await createNativePasswordResetLimiter(prisma)
          .consume(${JSON.stringify(testEmail)})));
      } finally { await prisma.$disconnect(); }
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        env: {
          ...process.env,
          TEST_DATABASE_URL: environment.TEST_DATABASE_URL,
        },
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
    expect(
      await firstPrisma.nativePasswordResetQuota.findUnique({
        where: { keyHash },
      }),
    ).toMatchObject({ attempts: 3 });
  });

  it("returns the rounded remaining database window without extending it on denial", async () => {
    await firstPrisma.$executeRaw`
      INSERT INTO native_password_reset_quotas (key_hash, window_started_at, attempts)
      VALUES (${keyHash}, clock_timestamp() - INTERVAL '10 minutes', 3)`;
    const before = await firstPrisma.$queryRaw<Array<{ remaining: number }>>`
      SELECT ceil(extract(epoch FROM window_started_at + INTERVAL '15 minutes' - clock_timestamp()))::int AS remaining
      FROM native_password_reset_quotas WHERE key_hash = ${keyHash}`;
    const denied = await secondLimiter.consume(testEmail);
    const after = await firstPrisma.$queryRaw<Array<{ remaining: number }>>`
      SELECT ceil(extract(epoch FROM window_started_at + INTERVAL '15 minutes' - clock_timestamp()))::int AS remaining
      FROM native_password_reset_quotas WHERE key_hash = ${keyHash}`;
    expect(denied.allowed).toBe(false);
    if (denied.allowed || before[0] === undefined || after[0] === undefined)
      throw new Error("Missing denied quota clock bounds");
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(before[0].remaining);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(after[0].remaining);
    expect(
      await firstPrisma.nativePasswordResetQuota.findUnique({
        where: { keyHash },
      }),
    ).toMatchObject({ attempts: 3 });
  });
});
