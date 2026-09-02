import type { ReceivingRepository } from "./receiving-repository.ts";

export function createReceivingService({
  repository,
}: {
  repository: ReceivingRepository;
}) {
  return repository;
}

export type ReceivingService = ReturnType<typeof createReceivingService>;
