import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.ts";
import type { ApiEnvironment } from "../environment.ts";

export function createPrismaClient(
  environment: Pick<ApiEnvironment, "DATABASE_URL">,
): PrismaClient {
  const adapter = new PrismaPg({ connectionString: environment.DATABASE_URL });

  return new PrismaClient({ adapter });
}

let prismaClient: PrismaClient | undefined;

export function getPrismaClient(
  environment: Pick<ApiEnvironment, "DATABASE_URL">,
): PrismaClient {
  prismaClient ??= createPrismaClient(environment);

  return prismaClient;
}
