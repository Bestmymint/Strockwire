import type { InventoryRepository } from "./inventory-repository.ts";

export function createInventoryService({
  repository,
}: {
  repository: InventoryRepository;
}) {
  return repository;
}

export type InventoryService = ReturnType<typeof createInventoryService>;
