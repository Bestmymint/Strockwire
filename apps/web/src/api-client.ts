import { z } from "zod";

import { API_HEALTH_PATH } from "./api-proxy";

const apiHealthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>;

export async function fetchApiHealth(): Promise<ApiHealthResponse> {
  const response = await fetch(API_HEALTH_PATH, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("The API health check was unavailable.");
  }

  return apiHealthResponseSchema.parse(await response.json());
}
