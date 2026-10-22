import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

export type OwnedSourceCopy = { path: string; device: bigint; inode: bigint };
export async function createOwnedSourceCopy(
  parent: string,
): Promise<OwnedSourceCopy> {
  const path = await mkdtemp(join(parent, ".stockwise-d4n3-"));
  const identity = await lstat(path, { bigint: true });
  return { path, device: identity.dev, inode: identity.ino };
}
async function removeCapturedCopy(owned: OwnedSourceCopy) {
  const identity = await lstat(owned.path, { bigint: true });
  if (
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    identity.dev !== owned.device ||
    identity.ino !== owned.inode
  ) {
    throw new Error("Owned source-copy identity changed; cleanup refused.");
  }
  await rm(owned.path, { recursive: true, force: false });
}
export async function finalizeOwnedSourceCopy(
  owned: OwnedSourceCopy,
  retainEvidence: () => Promise<void>,
  executionFailure?: unknown,
): Promise<void> {
  const failures: unknown[] =
    executionFailure === undefined ? [] : [executionFailure];
  try {
    try {
      await retainEvidence();
    } catch (error) {
      failures.push(error);
      console.log("D4N3_EVIDENCE_RETENTION:FAILED");
    }
  } finally {
    try {
      await removeCapturedCopy(owned);
      console.log("OWNED_SOURCE_COPY_CLEANUP:COMPLETE");
    } catch (error) {
      failures.push(error);
      console.log("OWNED_SOURCE_COPY_CLEANUP:FAILED");
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "D4N3 execution, retention or cleanup failed.",
    );
}
