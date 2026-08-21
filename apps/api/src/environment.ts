import { z } from "zod";

export const apiEnvironmentSchema = z.object({}).strict();

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(): ApiEnvironment {
  // P1-M2-T02 owns no configurable values. Future server settings must be
  // selected explicitly from process.env so unrelated values are never exposed.
  return apiEnvironmentSchema.parse({});
}
