import { z } from "zod";

export const apiEnvironmentSchema = z
  .object({
    STOCKWISE_API_PORT: z.coerce.number().int().min(1).max(65_535),
  })
  .strict();

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApiEnvironment {
  return apiEnvironmentSchema.parse({
    STOCKWISE_API_PORT: environment.STOCKWISE_API_PORT,
  });
}
