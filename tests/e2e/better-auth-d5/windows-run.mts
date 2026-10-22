import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, type SourceEntry } from "./source-contract.mts";
import {
  captureWindowsSource,
  validateWindowsEnvironment,
  windowsSourceManifest,
} from "./windows-source.mts";

// This R2 entrypoint cannot import the resource adapter or start application/test children.
// Later resource and schema execution require separate review and exact operation grants.
export async function checkWindowsSourceRequest(
  root: string,
  bytes: string,
  reviewedRequestSha256: string,
  environment: Readonly<Record<string, string | undefined>>,
) {
  validateWindowsEnvironment(environment);
  if (
    !/^[a-f0-9]{64}$/.test(reviewedRequestSha256) ||
    digest(bytes) !== reviewedRequestSha256
  )
    throw new Error("REVIEWED_SOURCE_REQUEST_REQUIRED");
  const input: unknown = JSON.parse(bytes);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("SOURCE_REQUEST_INVALID");
  const request = input as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !== "files,requiredTests" ||
    !Array.isArray(request.files) ||
    !Array.isArray(request.requiredTests)
  )
    throw new Error("SOURCE_REQUEST_INVALID");
  const files: SourceEntry[] = request.files.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("SOURCE_REQUEST_INVALID");
    const file = entry as Record<string, unknown>;
    if (
      Object.keys(file).sort().join(",") !== "path,sha256" ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string"
    )
      throw new Error("SOURCE_REQUEST_INVALID");
    return { path: file.path, sha256: file.sha256 };
  });
  const requiredTests = request.requiredTests.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("SOURCE_REQUEST_INVALID");
    const test = entry as Record<string, unknown>;
    if (
      Object.keys(test).sort().join(",") !== "file,id" ||
      typeof test.file !== "string" ||
      typeof test.id !== "string"
    )
      throw new Error("SOURCE_REQUEST_INVALID");
    return { file: test.file, id: test.id };
  });
  const snapshot = await captureWindowsSource(root, files, requiredTests);
  return {
    ...windowsSourceManifest(snapshot),
    execution: "NOT_RUN",
    resourceExecutionAvailableFromCli: false,
  };
}

async function main() {
  const environment = process.env;
  try {
    validateWindowsEnvironment(environment);
    if (process.argv.length !== 2) throw new Error("SOURCE_ONLY_ENTRYPOINT");
    const requestPath = environment.STOCKWISE_D5_R2_REQUEST;
    const reviewedHash = environment.STOCKWISE_D5_R2_REQUEST_SHA256;
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    if (!requestPath || !reviewedHash || !isAbsolute(requestPath))
      throw new Error("EXTERNAL_REVIEWED_SOURCE_REQUEST_REQUIRED");
    const location = relative(root, resolve(requestPath));
    if (
      !location.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(location)
    )
      throw new Error("EXTERNAL_REVIEWED_SOURCE_REQUEST_REQUIRED");
    const bytes = await readFile(requestPath, "utf8");
    const manifest = await checkWindowsSourceRequest(
      root,
      bytes,
      reviewedHash,
      environment,
    );
    console.log(JSON.stringify(manifest));
  } catch {
    // Do not echo inherited environment values, paths, request bytes or raw process errors.
    console.error("D5_R2_SOURCE_CHECK_REFUSED");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
