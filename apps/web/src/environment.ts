import { z } from "zod";

const loopbackApiOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);

    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.origin === value
    );
  }, "must be an http://127.0.0.1 origin without a path");

export const webEnvironmentSchema = z
  .object({
    STOCKWISE_API_ORIGIN: loopbackApiOriginSchema,
  })
  .strict();

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function loadWebEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebEnvironment {
  return webEnvironmentSchema.parse({
    STOCKWISE_API_ORIGIN: environment.STOCKWISE_API_ORIGIN,
  });
}
