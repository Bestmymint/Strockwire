import { z } from "zod";

export const apiEnvironmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "postgresql:", {
        message: "must be a postgresql:// connection URL",
      }),
    STOCKWISE_API_PORT: z.coerce.number().int().min(1).max(65_535),
  })
  .strict();

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApiEnvironment {
  return apiEnvironmentSchema.parse({
    DATABASE_URL: environment.DATABASE_URL,
    STOCKWISE_API_PORT: environment.STOCKWISE_API_PORT,
  });
}
