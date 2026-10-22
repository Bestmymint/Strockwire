import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadWindowsDockerCliApproval } from "./windows-docker-cli.mts";

const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function createDockerCliFixture(
  directory: string,
  executable?: string,
): {
  approval: ReturnType<typeof loadWindowsDockerCliApproval>;
  executable: string;
  approvalPath: string;
  launchApprovalSha256: string;
  reviewedSha256: string;
} {
  mkdirSync(directory, { recursive: true });
  const root = realpathSync.native(resolve(directory));
  const candidateRoot = join(root, "source");
  const deploymentRoot = join(root, "deployment");
  mkdirSync(candidateRoot, { recursive: true });
  mkdirSync(deploymentRoot, { recursive: true });
  const cli = resolve(executable ?? join(root, "fixture-cli.exe"));
  if (!executable) {
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, "inert fixture executable; never launched\n", {
      flag: "wx",
    });
  }
  const canonicalCli = realpathSync.native(cli);
  const executableSha256 = digest(readFileSync(canonicalCli));
  const approvalPath = join(root, "cli-approval.json");
  const launchApprovalSha256 = digest("fixture launch approval v1");
  const bytes = Buffer.from(
    JSON.stringify({
      contract: "D5-WINDOWS-DOCKER-CLI-v1",
      launchApprovalSha256,
      executable: canonicalCli,
      executableSha256,
    }),
  );
  writeFileSync(approvalPath, bytes, { flag: "wx" });
  const reviewedSha256 = digest(bytes);
  const approval = loadWindowsDockerCliApproval(
    approvalPath,
    reviewedSha256,
    launchApprovalSha256,
    candidateRoot,
    deploymentRoot,
  );
  return {
    approval,
    executable: canonicalCli,
    approvalPath,
    launchApprovalSha256,
    reviewedSha256,
  };
}
