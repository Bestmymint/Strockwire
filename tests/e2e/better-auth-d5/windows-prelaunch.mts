import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureWindowsModuleClosure } from "./windows-module-closure.mts";
import {
  validateWindowsBootstrapDeployment,
  validateWindowsNodeLaunch,
  type WindowsBootstrapPin,
} from "./windows-launch.mts";
import {
  sanitizeWindowsEnvironment,
  validateWindowsEnvironment,
} from "./windows-source.mts";

export interface WindowsPrelaunchApproval {
  contract: "D5-WINDOWS-PRELAUNCH-v1";
  candidateRoot: string;
  pin: WindowsBootstrapPin;
  verifier: {
    root: string;
    entryModule: "windows-prelaunch.mts";
    files: { path: string; sha256: string }[];
  };
}
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const verifierFiles = [
  "migration-contract.mts",
  "source-contract.mts",
  "windows-launch.mts",
  "windows-module-closure.mts",
  "windows-prelaunch.mts",
  "windows-source.mts",
  "node_modules/typescript/package.json",
  "node_modules/typescript/lib/typescript.js",
].sort();
function fail(): never {
  throw new Error("WINDOWS_PRELAUNCH_REFUSED");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}
export function parseWindowsPrelaunchApproval(
  bytes: string,
  independentlyReviewedSha256: string,
): WindowsPrelaunchApproval {
  if (
    !/^[a-f0-9]{64}$/.test(independentlyReviewedSha256) ||
    hash(bytes) !== independentlyReviewedSha256
  )
    return fail();
  const value = object(JSON.parse(bytes));
  if (
    Object.keys(value).sort().join(",") !==
      "candidateRoot,contract,pin,verifier" ||
    value.contract !== "D5-WINDOWS-PRELAUNCH-v1" ||
    typeof value.candidateRoot !== "string"
  )
    return fail();
  const verifier = object(value.verifier);
  if (
    Object.keys(verifier).sort().join(",") !== "entryModule,files,root" ||
    verifier.entryModule !== "windows-prelaunch.mts" ||
    typeof verifier.root !== "string" ||
    !Array.isArray(verifier.files)
  )
    return fail();
  const names = verifier.files
    .map((item) => {
      const row = object(item);
      if (
        Object.keys(row).sort().join(",") !== "path,sha256" ||
        typeof row.path !== "string" ||
        typeof row.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.sha256)
      )
        return fail();
      return row.path;
    })
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(verifierFiles)) return fail();
  object(value.pin);
  return value as unknown as WindowsPrelaunchApproval;
}
async function regularFile(root: string, path: string): Promise<Buffer> {
  const full = resolve(root, path);
  const local = relative(root, full);
  if (
    !local ||
    isAbsolute(local) ||
    local === ".." ||
    local.startsWith(`..${sep}`)
  )
    return fail();
  let current = root;
  for (const part of local.split(sep)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return fail();
    current = resolve(current, part);
  }
  const stat = await lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
    return fail();
  return readFile(full);
}
async function verifyTcb(approval: WindowsPrelaunchApproval): Promise<void> {
  const root = resolve(approval.verifier.root);
  if (
    !isAbsolute(approval.verifier.root) ||
    root !== resolve(dirname(fileURLToPath(import.meta.url)))
  )
    return fail();
  const candidate = relative(resolve(approval.candidateRoot), root);
  const outside =
    isAbsolute(candidate) ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`);
  if (!outside) return fail();
  for (const file of approval.verifier.files)
    if (hash(await regularFile(root, file.path)) !== file.sha256) return fail();
}
export type WindowsSupervisorTransport = (
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => Promise<{ code: number; stdout: string }>;
const nodeSupervisor: WindowsSupervisorTransport = (
  executable,
  args,
  cwd,
  environment,
) =>
  new Promise((resolveResult, reject) => {
    execFile(
      executable,
      [...args],
      {
        cwd,
        env: environment,
        shell: false,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) return reject(new Error("WINDOWS_SUPERVISOR_FAILED"));
        resolveResult({ code: 0, stdout });
      },
    );
  });

/** Called only after the independently reviewed native launcher has hashed this verifier and its parser. */
export async function launchWindowsSupervisor(
  approvalBytes: string,
  reviewedSha256: string,
  environment: NodeJS.ProcessEnv,
  transport: WindowsSupervisorTransport = nodeSupervisor,
): Promise<{ code: number; stdout: string }> {
  validateWindowsEnvironment(environment);
  validateWindowsNodeLaunch([], "file", environment);
  const approval = parseWindowsPrelaunchApproval(approvalBytes, reviewedSha256);
  const pin = structuredClone(approval.pin);
  await verifyTcb(approval);
  const observe = async () => ({
    root: pin.root,
    nodeExecutable: pin.nodeExecutable,
    nodeExecutableSha256: hash(await readFile(pin.nodeExecutable)),
    workingDirectory: pin.workingDirectory,
    entryModule: pin.entryModule,
    invocationMode: "file" as const,
    execArgv: [] as string[],
    closure: await captureWindowsModuleClosure(pin.root, pin.entryModule),
  });
  if (transport === nodeSupervisor) {
    validateWindowsEnvironment(process.env);
    validateWindowsNodeLaunch(process.execArgv, "file", process.env);
  }
  validateWindowsBootstrapDeployment(
    pin,
    await observe(),
    approval.candidateRoot,
  );
  // Re-read immediately before dispatch; no candidate/supervisor code has executed.
  await verifyTcb(approval);
  validateWindowsBootstrapDeployment(
    pin,
    await observe(),
    approval.candidateRoot,
  );
  return transport(
    pin.nodeExecutable,
    [resolve(pin.root, pin.entryModule)],
    pin.workingDirectory,
    {
      ...sanitizeWindowsEnvironment(environment),
      STOCKWISE_D5_LAUNCH_APPROVAL_PATH:
        environment.STOCKWISE_D5_LAUNCH_APPROVAL_PATH,
      STOCKWISE_D5_LAUNCH_APPROVAL_SHA256:
        environment.STOCKWISE_D5_LAUNCH_APPROVAL_SHA256,
      STOCKWISE_D5_CLI_APPROVAL_PATH:
        environment.STOCKWISE_D5_CLI_APPROVAL_PATH,
      STOCKWISE_D5_CLI_APPROVAL_SHA256:
        environment.STOCKWISE_D5_CLI_APPROVAL_SHA256,
      STOCKWISE_D5_SUPERVISOR_PLAN_PATH:
        environment.STOCKWISE_D5_SUPERVISOR_PLAN_PATH,
      STOCKWISE_D5_SUPERVISOR_PLAN_SHA256:
        environment.STOCKWISE_D5_SUPERVISOR_PLAN_SHA256,
    },
  );
}

async function main(): Promise<void> {
  try {
    validateWindowsEnvironment(process.env);
    validateWindowsNodeLaunch(process.execArgv, "file", process.env);
    if (process.argv.length !== 4 || !process.argv[2] || !process.argv[3])
      return fail();
    const result = await launchWindowsSupervisor(
      await readFile(process.argv[2], "utf8"),
      process.argv[3],
      process.env,
    );
    console.log(
      JSON.stringify({ stage: "SUPERVISOR_EXIT", exitCode: result.code }),
    );
  } catch {
    console.error("WINDOWS_PRELAUNCH_REFUSED");
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
