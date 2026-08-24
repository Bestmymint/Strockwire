import type { CatalogRepository } from "./catalog-repository.ts";

export function createCatalogService({
  repository,
}: {
  repository: CatalogRepository;
}) {
  return repository;
}

export type CatalogService = ReturnType<typeof createCatalogService>;
