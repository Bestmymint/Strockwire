import { expect, it } from "vitest";

import { createPrismaClient } from "../prisma/client.ts";
import { loadDemoEnvironment } from "./demo-environment.ts";
import { runDemoFixture } from "./demo-runner.ts";
import { validateDemoGoldens } from "./demo-validation.ts";

it.skipIf(!process.env.DEMO_DATABASE_URL || !process.env.DEMO_USER_PASSWORD)(
  "generates the complete fixture once and preserves an exact no-op rerun",
  async () => {
    const { databaseUrl, password } = loadDemoEnvironment();
    const prisma = createPrismaClient({ DATABASE_URL: databaseUrl });
    try {
      expect(await runDemoFixture(prisma, password)).toBe("generated");
      await validateDemoGoldens(prisma);
      const before = await prisma.user.findMany({
        select: { id: true, passwordHash: true },
        orderBy: { id: "asc" },
      });
      expect(await runDemoFixture(prisma, password)).toBe("no-op");
      await validateDemoGoldens(prisma);
      const after = await prisma.user.findMany({
        select: { id: true, passwordHash: true },
        orderBy: { id: "asc" },
      });
      expect(after).toEqual(before);
      expect(await prisma.sale.count()).toBe(1266);
      expect(await prisma.saleItem.count()).toBe(2488);
      expect(await prisma.inventoryTransaction.count()).toBe(2599);
      await expect(runDemoFixture(prisma, `${password}!`)).rejects.toThrow(
        /A demo user credential differs/,
      );
      expect(
        await prisma.user.findMany({
          select: { id: true, passwordHash: true },
          orderBy: { id: "asc" },
        }),
      ).toEqual(before);
    } finally {
      await prisma.$disconnect();
    }
  },
  60_000,
);
