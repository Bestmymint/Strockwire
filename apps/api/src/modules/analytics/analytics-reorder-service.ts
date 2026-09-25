import type { ReorderRepository } from "./analytics-reorder-repository.ts";

export function createReorderService(repository: ReorderRepository) {
  return {
    read(request: Parameters<ReorderRepository["read"]>[0]) {
      return repository.read(request);
    },
  };
}
