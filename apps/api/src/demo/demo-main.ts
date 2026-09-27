import { createPrismaClient } from "../prisma/client.ts";
import { loadDemoEnvironment } from "./demo-environment.ts";
import { runDemoFixture } from "./demo-runner.ts";
import { validateDemoGoldens } from "./demo-validation.ts";

async function main(): Promise<void> {
  const { databaseUrl, databaseName, password } = loadDemoEnvironment();
  const prisma = createPrismaClient({ DATABASE_URL: databaseUrl });
  try {
    const result = await runDemoFixture(prisma, password);
    await validateDemoGoldens(prisma);
    process.stdout.write(
      `stockwise-demo-v1 ${result} on ${databaseName}; manifest, reconciliation, and fixed-clock goldens validated.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma/provider errors may include the connection URL; emit only our
  // deliberately credential-free validation messages.
  const safe =
    error instanceof Error &&
    /^(?:DEMO_DATABASE_URL|DEMO_USER_PASSWORD|Demo |The stockwise-demo-v1|Database schema|Migration state|A demo user|[a-z_]+ (?:row count|differs))/.test(
      error.message,
    )
      ? error.message
      : "Demo generation or validation failed; check the guarded target and schema.";
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
});
