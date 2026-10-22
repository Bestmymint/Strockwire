import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(
  new URL("./windows-supervisor.mts", import.meta.url),
);

// Audited negatives only: no approval/plan, no Docker executable on PATH,
// no candidate source read, no deployment copy, and no resource transport invocation.
async function inertChild(args: string[], extras: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "d5-supervisor-inert-"));
  try {
    const result = await new Promise<{
      code: number | string | null;
      stdout: string;
      stderr: string;
    }>((done) => {
      execFile(
        process.execPath,
        [...args, entry],
        {
          cwd: directory,
          shell: false,
          timeout: 10_000,
          maxBuffer: 65536,
          env: {
            PATH: directory,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: directory,
            TMP: directory,
            ...extras,
          },
        },
        (error, stdout, stderr) =>
          done({ code: error?.code ?? 0, stdout, stderr }),
      );
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "WINDOWS_SUPERVISOR_REFUSED");
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("operational supervisor with no deployment approval or plan is inert in a real Node process", async () => {
  await inertChild([]);
});

test("operational supervisor refuses Node options before reading operational input", async () => {
  await inertChild(["--no-warnings"]);
});

test("operational supervisor refuses original prohibited environment names without exposing their values", async () => {
  await inertChild([], { DATABASE_URL: "not-a-connection-string" });
});

test("operational supervisor refuses application arguments rather than treating them as commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "d5-supervisor-args-"));
  try {
    const result = await new Promise<{
      code: number | string | null;
      stderr: string;
    }>((done) => {
      execFile(
        process.execPath,
        [entry, "acquire"],
        {
          cwd: directory,
          shell: false,
          timeout: 10_000,
          maxBuffer: 65536,
          env: {
            PATH: directory,
            SystemRoot: process.env.SystemRoot,
            TEMP: directory,
            TMP: directory,
          },
        },
        (error, _stdout, stderr) => done({ code: error?.code ?? 0, stderr }),
      );
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr.trim(), "WINDOWS_SUPERVISOR_REFUSED");
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
