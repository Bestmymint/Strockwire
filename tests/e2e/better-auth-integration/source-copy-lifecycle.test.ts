import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  createOwnedSourceCopy,
  finalizeOwnedSourceCopy,
} from "./source-copy-lifecycle";

async function fixture(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "d4n3-cleanup-regression-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("retention failure still removes only the owned source copy", async () =>
  fixture(async (root) => {
    const owned = await createOwnedSourceCopy(root);
    const sibling = join(root, "unrelated.txt");
    await writeFile(sibling, "preserve");
    await writeFile(join(owned.path, "scratch.txt"), "owned");
    const retentionFailure = new Error("synthetic retention failure");
    await expect(
      finalizeOwnedSourceCopy(owned, async () => {
        throw retentionFailure;
      }),
    ).rejects.toBe(retentionFailure);
    await expect(lstat(owned.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(sibling, "utf8")).toBe("preserve");
  }));

test("preserves the original execution failure together with a retention failure", async () =>
  fixture(async (root) => {
    const owned = await createOwnedSourceCopy(root);
    const executionFailure = new Error("synthetic execution failure");
    const retentionFailure = new Error("synthetic retention failure");
    let failure: unknown;
    try {
      await finalizeOwnedSourceCopy(
        owned,
        async () => {
          throw retentionFailure;
        },
        executionFailure,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error("aggregate failure missing");
    expect(failure.errors).toEqual([executionFailure, retentionFailure]);
    await expect(lstat(owned.path)).rejects.toMatchObject({ code: "ENOENT" });
  }));

test("successful retention does not replace the execution failure and still cleans up", async () =>
  fixture(async (root) => {
    const owned = await createOwnedSourceCopy(root);
    const executionFailure = new Error("synthetic execution failure");
    await expect(
      finalizeOwnedSourceCopy(owned, async () => {}, executionFailure),
    ).rejects.toBe(executionFailure);
    await expect(lstat(owned.path)).rejects.toMatchObject({ code: "ENOENT" });
  }));

test("refuses cleanup of a different directory substituted at the captured path", async () =>
  fixture(async (root) => {
    const owned = await createOwnedSourceCopy(root);
    const moved = join(root, "captured-original");
    await rename(owned.path, moved);
    await mkdir(owned.path);
    const replacement = join(owned.path, "keep.txt");
    await writeFile(replacement, "not the captured copy");
    await expect(
      finalizeOwnedSourceCopy(owned, async () => {}),
    ).rejects.toThrow("identity changed");
    expect(await readFile(replacement, "utf8")).toBe("not the captured copy");
    expect((await lstat(moved)).isDirectory()).toBe(true);
  }));

test("reports retention and refused-cleanup failures without deleting replacement data", async () =>
  fixture(async (root) => {
    const owned = await createOwnedSourceCopy(root);
    await rename(owned.path, join(root, "captured-original"));
    await mkdir(owned.path);
    const retentionFailure = new Error("synthetic retention failure");
    let failure: unknown;
    try {
      await finalizeOwnedSourceCopy(owned, async () => {
        throw retentionFailure;
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error("aggregate failure missing");
    expect(failure.errors[0]).toBe(retentionFailure);
    expect(failure.errors[1]).toBeInstanceOf(Error);
    expect((await lstat(owned.path)).isDirectory()).toBe(true);
  }));
