import type { SupplierRepository } from "./supplier-repository.ts";

export function createSupplierService({
  repository,
}: {
  repository: SupplierRepository;
}) {
  return repository;
}
export type SupplierService = ReturnType<typeof createSupplierService>;
