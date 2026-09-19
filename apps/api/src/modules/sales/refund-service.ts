import type { RefundRepository } from "./refund-repository.ts";

export function createRefundService({
  repository,
}: {
  repository: RefundRepository;
}) {
  return repository;
}

export type RefundService = ReturnType<typeof createRefundService>;
