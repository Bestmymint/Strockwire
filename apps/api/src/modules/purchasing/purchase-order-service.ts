import type { PurchaseOrderRepository } from "./purchase-order-repository.ts";

export function createPurchaseOrderService({
  repository,
}: {
  repository: PurchaseOrderRepository;
}) {
  return repository;
}

export type PurchaseOrderService = ReturnType<
  typeof createPurchaseOrderService
>;
