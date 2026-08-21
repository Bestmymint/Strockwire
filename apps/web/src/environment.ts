import { z } from "zod";

export const webEnvironmentSchema = z.object({}).strict();

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function loadWebEnvironment(): WebEnvironment {
  // P1-M2-T01 owns no configurable values. Future web settings must be selected
  // explicitly from process.env here so unrelated server values cannot leak.
  return webEnvironmentSchema.parse({});
}
