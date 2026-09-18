import type { CheckoutRepository } from "./checkout-repository.ts";

export function createCheckoutService({
  repository,
}: {
  repository: CheckoutRepository;
}) {
  return repository;
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
