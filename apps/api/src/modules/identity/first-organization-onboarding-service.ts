import type { FirstOrganizationOnboardingRepository } from "./first-organization-onboarding-repository.ts";
import {
  hashFirstOrganizationOnboardingRequest,
  type FirstOrganizationOnboardingInput,
} from "./first-organization-onboarding-schema.ts";

export function createFirstOrganizationOnboardingService({
  repository,
}: {
  repository: FirstOrganizationOnboardingRepository;
}) {
  return {
    complete(
      actorUserId: string,
      onboarding: FirstOrganizationOnboardingInput,
    ) {
      return repository.complete({
        actorUserId,
        onboarding,
        requestHash: hashFirstOrganizationOnboardingRequest(onboarding),
      });
    },
  };
}

export type FirstOrganizationOnboardingService = ReturnType<
  typeof createFirstOrganizationOnboardingService
>;
