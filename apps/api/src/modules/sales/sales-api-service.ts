import type { SalesApiRepository } from "./sales-api-repository.ts";

export function createSalesApiService({
  repository,
}: {
  repository: SalesApiRepository;
}) {
  return repository;
}

export type SalesApiService = ReturnType<typeof createSalesApiService>;
