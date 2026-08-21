import { loadApiEnvironment } from "../environment.ts";
import { createPrismaClient } from "./client.ts";

async function main(): Promise<void> {
  const environment = loadApiEnvironment();
  const prisma = createPrismaClient(environment);

  try {
    const result = await prisma.$queryRaw<
      { ready: number }[]
    >`SELECT 1 AS ready`;

    if (result[0]?.ready !== 1) {
      throw new Error(
        "PostgreSQL connectivity query returned an unexpected result.",
      );
    }

    console.log("PostgreSQL connectivity check passed.");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `PostgreSQL connectivity check failed: ${error.message}`
      : "PostgreSQL connectivity check failed.",
  );
  process.exitCode = 1;
});
