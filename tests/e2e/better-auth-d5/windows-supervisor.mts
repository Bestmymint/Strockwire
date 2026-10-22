import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateWindowsBootstrapDeployment,
  validateWindowsNodeLaunch,
  type WindowsBootstrapPin,
} from "./windows-launch.mts";
import {
  observeWindowsResourceDeployment,
  parseWindowsResourceRequest,
} from "./windows-resource-invocation.mts";
import {
  execFileDockerTransport,
  WindowsDockerLease,
  type WindowsResourceOptions,
} from "./windows-resources.mts";
import {
  captureWindowsSource,
  sanitizeWindowsEnvironment,
  validateWindowsEnvironment,
  verifyWindowsSource,
  windowsSourceManifest,
} from "./windows-source.mts";
import {
  openSupervisorChannel,
  parseSupervisorPlan,
  readSupervisorFile,
} from "./windows-supervisor-protocol.mts";
import {
  runSupervisorSession,
  type SupervisorGuard,
  type SupervisorResult,
} from "./windows-supervisor-session.mts";
import { loadWindowsDockerCliApproval } from "./windows-docker-cli.mts";

function refuse(): never {
  throw new Error("WINDOWS_SUPERVISOR_REFUSED");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  return value as Record<string, unknown>;
}
function originalEnvironment(): void {
  validateWindowsEnvironment(process.env);
  validateWindowsNodeLaunch(process.execArgv, "file", process.env);
  if (process.argv.length !== 2) refuse();
}
function outside(root: string, file: string): boolean {
  const local = relative(root, file);
  return isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`);
}
function absoluteFile(value: string | undefined): string {
  if (
    !value ||
    !/^[A-Za-z]:\\/.test(value) ||
    value.includes("/") ||
    win32.normalize(value) !== value ||
    !win32.isAbsolute(value)
  )
    refuse();
  return value;
}
const digest = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

/** No authority or test transport can be selected by CLI arguments or environment flags. */
export async function runWindowsSupervisor(): Promise<SupervisorResult> {
  const startedAt = Date.now();
  originalEnvironment();
  const approvalPath = absoluteFile(
    process.env.STOCKWISE_D5_LAUNCH_APPROVAL_PATH,
  );
  const approvalHash = process.env.STOCKWISE_D5_LAUNCH_APPROVAL_SHA256;
  if (!approvalHash || !/^[a-f0-9]{64}$/.test(approvalHash)) refuse();
  const approvalBytes = await readSupervisorFile(approvalPath, 1024 * 1024);
  if (digest(approvalBytes) !== approvalHash) refuse();
  const approval = object(JSON.parse(approvalBytes));
  if (
    Object.keys(approval).sort().join(",") !==
      "candidateRoot,contract,pin,verifier" ||
    approval.contract !== "D5-WINDOWS-PRELAUNCH-v1" ||
    typeof approval.candidateRoot !== "string"
  )
    refuse();
  const candidateRoot = absoluteFile(approval.candidateRoot);
  if (!outside(candidateRoot, approvalPath)) refuse();
  const pin = object(approval.pin) as unknown as WindowsBootstrapPin;
  const verifier = object(approval.verifier);
  if (
    Object.keys(verifier).sort().join(",") !== "entryModule,files,root" ||
    verifier.entryModule !== "windows-prelaunch.mts" ||
    typeof verifier.root !== "string" ||
    !Array.isArray(verifier.files)
  )
    refuse();
  const checkDeployment = async () => {
    originalEnvironment();
    if (
      digest(await readSupervisorFile(approvalPath, 1024 * 1024)) !==
      approvalHash
    )
      refuse();
    validateWindowsBootstrapDeployment(
      pin,
      await observeWindowsResourceDeployment(candidateRoot, pin),
      candidateRoot,
    );
  };
  await checkDeployment();
  const dockerCli = loadWindowsDockerCliApproval(
    absoluteFile(process.env.STOCKWISE_D5_CLI_APPROVAL_PATH),
    process.env.STOCKWISE_D5_CLI_APPROVAL_SHA256 ?? "",
    approvalHash,
    candidateRoot,
    pin.root,
  );
  const planPath = absoluteFile(process.env.STOCKWISE_D5_SUPERVISOR_PLAN_PATH);
  const planHash = process.env.STOCKWISE_D5_SUPERVISOR_PLAN_SHA256;
  if (
    !planHash ||
    !outside(candidateRoot, planPath) ||
    !outside(pin.root, planPath)
  )
    refuse();
  const planBytes = await readSupervisorFile(planPath, 2 * 1024 * 1024);
  const plan = parseSupervisorPlan(planBytes, planHash);
  if (plan.candidateRoot !== candidateRoot) refuse();
  const request = parseWindowsResourceRequest(
    plan.requestBytes,
    plan.requestSha256,
  );
  const source = await captureWindowsSource(
    candidateRoot,
    request.files,
    request.requiredTests,
  );
  const manifest = windowsSourceManifest(source);
  if (
    manifest.sourceSha256 !== plan.sourceSha256 ||
    manifest.migrationSha256 !== plan.migrationSha256
  )
    refuse();
  const verify = async () => {
    await checkDeployment();
    if (
      digest(await readSupervisorFile(planPath, 2 * 1024 * 1024)) !== planHash
    )
      refuse();
    await verifyWindowsSource(source, candidateRoot);
  };
  const channel = await openSupervisorChannel(plan, pin.root);
  // The soft session limit is <=60s. One existing command is bounded at 30s;
  // the unchanged prelaunch 120s ceiling retains a release/evidence margin.
  const beforeDispatch = (guard: SupervisorGuard) => ({
    check: async () => {
      await guard();
      originalEnvironment();
    },
    assertTime: () => {
      originalEnvironment();
      guard.assertTime();
    },
  });
  const options = (
    guard: SupervisorGuard,
  ): Omit<WindowsResourceOptions, "g3c" | "reviewPins"> => ({
    leaseId: request.leaseId,
    journalDirectory: request.journalDirectory,
    environment: sanitizeWindowsEnvironment(process.env),
    sourceSha256: manifest.sourceSha256,
    migrationSha256: manifest.migrationSha256,
    expectedSourceSha256: plan.sourceSha256,
    expectedMigrationSha256: plan.migrationSha256,
    operator: request.operator,
    endpoint: request.endpoint,
    daemonId: request.daemonId,
    image: request.image,
    resolvedImageId: request.resolvedImageId,
    dockerCli,
    transport: execFileDockerTransport,
    beforeDispatch: beforeDispatch(guard),
  });
  try {
    const remaining = Math.max(0, plan.timeoutMs - (Date.now() - startedAt));
    return await runSupervisorSession(
      { ...plan, timeoutMs: remaining },
      {
        channel,
        now: Date.now,
        sleep: (milliseconds) =>
          new Promise((done) => setTimeout(done, milliseconds)),
        verify,
        acquire: (grant, reviewedHash, guard) =>
          WindowsDockerLease.acquire({
            ...options(guard),
            g3c: grant,
            reviewPins: { g3cSha256: reviewedHash },
          }),
        recover: (checkpoint, guard) =>
          WindowsDockerLease.recoverCleanup(options(guard), checkpoint),
      },
    );
  } finally {
    await channel.close();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runWindowsSupervisor();
    // Resource identities/checkpoints are durable file evidence, never raw console payloads.
    console.log(
      JSON.stringify({
        stage: "SUPERVISOR_EXIT",
        state: result.state,
        verdict: result.verdict,
        cleanup: result.cleanup,
      }),
    );
    if (result.verdict !== "PASS") process.exitCode = 1;
  } catch {
    console.error("WINDOWS_SUPERVISOR_REFUSED");
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
