import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { win32 } from "node:path";

export type ApprovedWindowsDockerCli = Readonly<{
  path: string;
  sha256: string;
}>;
type Issuance = {
  path: string;
  sha256: string;
  approvalPath: string;
  approvalSha256: string;
  launchApprovalSha256: string;
  candidateRoot: string;
  deploymentRoot: string;
};
const issuances = new WeakMap<ApprovedWindowsDockerCli, Issuance>();
const CONTRACT = "D5-WINDOWS-DOCKER-CLI-v1";
const MAX_CLI_BYTES = 256 * 1024 * 1024;
const MAX_APPROVAL_BYTES = 4096;
const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new Error("WINDOWS_DOCKER_CLI_INVALID");
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function canonicalWindowsPath(value: string): string {
  if (
    typeof value !== "string" ||
    hasAsciiControl(value) ||
    value.includes("/") ||
    value.startsWith("\\\\") ||
    value.length < 3 ||
    !/^[A-Za-z]:\\/.test(value)
  )
    fail();
  const parts = value.slice(3).split("\\");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[ .]$/.test(part) ||
        /[<>:"|?*]/.test(part) ||
        /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(
          part,
        ),
    )
  )
    fail();
  if (win32.normalize(value) !== value || value.endsWith("\\")) fail();
  return value;
}
function inside(path: string, root: string): boolean {
  const p = path.toLowerCase();
  const r = root.toLowerCase().replace(/\\+$/, "");
  return p === r || p.startsWith(`${r}\\`);
}
function stableDirectory(path: string): void {
  canonicalWindowsPath(path);
  let current = path.slice(0, 3);
  for (const part of path.slice(3).split("\\")) {
    current = `${current}${current.endsWith("\\") ? "" : "\\"}${part}`;
    const stat = lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  }
  if (realpathSync.native(path) !== path) fail();
}
function stableFile(path: string, maximum: number): Buffer {
  canonicalWindowsPath(path);
  let current = path.slice(0, 3);
  const parts = path.slice(3).split("\\");
  for (const [index, part] of parts.entries()) {
    current = `${current}${current.endsWith("\\") ? "" : "\\"}${part}`;
    const stat = lstatSync(current, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 && !stat.isDirectory())
    )
      fail();
  }
  const before = lstatSync(path, { bigint: true });
  if (
    !before.isFile() ||
    before.size > BigInt(maximum) ||
    realpathSync.native(path) !== path
  )
    fail();
  const bytes = readFileSync(path);
  const after = lstatSync(path, { bigint: true });
  if (
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    BigInt(bytes.length) !== after.size ||
    realpathSync.native(path) !== path
  )
    fail();
  return bytes;
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function inspect(issuance: Issuance): void {
  stableDirectory(issuance.candidateRoot);
  stableDirectory(issuance.deploymentRoot);
  const sidecar = stableFile(issuance.approvalPath, MAX_APPROVAL_BYTES);
  if (sha256(sidecar) !== issuance.approvalSha256) fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecar.toString("utf8"));
  } catch {
    fail();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    fail();
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "contract,executable,executableSha256,launchApprovalSha256" ||
    record.contract !== CONTRACT ||
    record.launchApprovalSha256 !== issuance.launchApprovalSha256 ||
    record.executable !== issuance.path ||
    record.executableSha256 !== issuance.sha256
  )
    fail();
  if (
    inside(issuance.approvalPath, issuance.candidateRoot) ||
    inside(issuance.approvalPath, issuance.deploymentRoot) ||
    inside(issuance.path, issuance.candidateRoot) ||
    !issuance.path.toLowerCase().endsWith(".exe")
  )
    fail();
  if (sha256(stableFile(issuance.path, MAX_CLI_BYTES)) !== issuance.sha256)
    fail();
}

export function loadWindowsDockerCliApproval(
  approvalPath: string,
  reviewedSha256: string,
  launchApprovalSha256: string,
  candidateRoot: string,
  deploymentRoot: string,
): ApprovedWindowsDockerCli {
  try {
    approvalPath = canonicalWindowsPath(approvalPath);
    candidateRoot = canonicalWindowsPath(candidateRoot);
    deploymentRoot = canonicalWindowsPath(deploymentRoot);
    if (!HASH.test(reviewedSha256) || !HASH.test(launchApprovalSha256)) fail();
    const sidecar = stableFile(approvalPath, MAX_APPROVAL_BYTES);
    if (sha256(sidecar) !== reviewedSha256) fail();
    const parsed: unknown = JSON.parse(sidecar.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      fail();
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !==
        "contract,executable,executableSha256,launchApprovalSha256" ||
      record.contract !== CONTRACT ||
      record.launchApprovalSha256 !== launchApprovalSha256 ||
      typeof record.executable !== "string" ||
      typeof record.executableSha256 !== "string" ||
      !HASH.test(record.executableSha256)
    )
      fail();
    const path = canonicalWindowsPath(record.executable);
    const issuance: Issuance = {
      path,
      sha256: record.executableSha256,
      approvalPath,
      approvalSha256: reviewedSha256,
      launchApprovalSha256,
      candidateRoot,
      deploymentRoot,
    };
    inspect(issuance);
    const approval = Object.freeze({ path, sha256: issuance.sha256 });
    issuances.set(approval, issuance);
    return approval;
  } catch {
    return fail();
  }
}
function authentic(approval: ApprovedWindowsDockerCli | undefined): Issuance {
  const issuance = approval && issuances.get(approval);
  if (!issuance) fail();
  return issuance;
}
export function verifyWindowsDockerCli(
  approval: ApprovedWindowsDockerCli | undefined,
): string {
  try {
    const issuance = authentic(approval);
    inspect(issuance);
    return issuance.path;
  } catch {
    return fail();
  }
}
export function windowsDockerCliBinding(
  approval: ApprovedWindowsDockerCli | undefined,
): Readonly<{
  path: string;
  sha256: string;
  approvalSha256: string;
  launchApprovalSha256: string;
}> {
  const { path, sha256, approvalSha256, launchApprovalSha256 } =
    authentic(approval);
  return Object.freeze({ path, sha256, approvalSha256, launchApprovalSha256 });
}
