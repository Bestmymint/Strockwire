import { describe, expect, it } from "vitest";

import { getPrismaClient } from "./client.ts";

describe("Prisma client lifecycle", () => {
  it("reuses one client instance without connecting during construction", async () => {
    const environment = {
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
    };

    const firstClient = getPrismaClient(environment);
    const secondClient = getPrismaClient(environment);

    expect(secondClient).toBe(firstClient);

    await firstClient.$disconnect();
  });
});
