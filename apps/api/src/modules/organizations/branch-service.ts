import type { BranchRepository } from "./branch-repository.ts";
import type { BranchCreateInput, BranchUpdateInput } from "./branch-schemas.ts";

export function createBranchService({
  repository,
}: {
  repository: BranchRepository;
}) {
  return {
    accessContext(actorUserId: string) {
      return repository.accessContext(actorUserId);
    },
    create(
      actorUserId: string,
      organizationId: string,
      input: BranchCreateInput,
    ) {
      return repository.create(actorUserId, organizationId, input);
    },
    list(
      actorUserId: string,
      organizationId: string,
      includeInactive: boolean,
    ) {
      return repository.list(actorUserId, organizationId, includeInactive);
    },
    setLifecycle(input: {
      actorUserId: string;
      branchId: string;
      expectedUpdatedAt: Date;
      organizationId: string;
      status: "ACTIVE" | "INACTIVE";
    }) {
      return repository.setLifecycle(input);
    },
    update(
      actorUserId: string,
      organizationId: string,
      branchId: string,
      input: BranchUpdateInput,
    ) {
      return repository.update(actorUserId, organizationId, branchId, input);
    },
  };
}

export type BranchService = ReturnType<typeof createBranchService>;
