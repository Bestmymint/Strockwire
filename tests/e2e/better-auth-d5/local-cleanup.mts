import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { LocalDockerTransport } from "./local-runner.mts";

const exec = promisify(execFile);
const JOURNAL =
  "D:/StockWise-D5/Runtime/f8a651a0-f35f-4793-b191-09f7d1dceb4d/journal/f8a651a0-f35f-4793-b191-09f7d1dceb4d/journal.jsonl";
const JOURNAL_SHA256 =
  "731b79b24d63f3e92d22f40d5868c083ee6d05e72508b3ec352ab3a1c62e3086";
const OWNER = "f8a651a0-f35f-4793-b191-09f7d1dceb4d";
const TOKEN = "82915e38-5b18-4525-a8b5-86bcf9ac227f";
const NETWORK_ID =
  "a4a8f08ba216729249b53cbd06f1605630079ab8e601d9e2ff694fadeeef1d29";
const CONTAINER_ID =
  "c5a1b4b49de06c578ecd5dc6356f1f1a8eefb2f6f4def8b819a3ff17f24a05f5";
const VOLUME_BIRTH = "2026-10-21T20:39:07Z";
const VOLUME = `sw-d5-${OWNER}-data`;
const NETWORK = `sw-d5-${OWNER}-net`;
const CONTAINER = `sw-d5-${OWNER}-pg`;
const EXPECTED_DAEMON = "34b7f6a0-e608-44c1-bca5-11c60dd363b9";
const DOCKER_SHA256 =
  "f71e5a9fe6a8db10c7296ad6fdf0c1d7d79634e644d7ec1e8a2c18d7dcb52d21";
const RELEASE_HEAD =
  "348e878a4b595485a206d52a17473700e3a6866acfdc25aa4a240eebf00d79aa";
type Obj = Record<string, unknown>;
export type LocalCleanupOptions = Readonly<{
  dockerExecutable: string;
  evidenceDirectory: string;
  transport?: LocalDockerTransport;
}>;

/** Removes only the exact previous lease whose full journal was independently validated by its pinned digest. */
export async function cleanupPreviousRun(
  options: LocalCleanupOptions,
): Promise<void> {
  if (
    !isAbsolute(options.evidenceDirectory) ||
    !isAbsolute(options.dockerExecutable)
  )
    throw new Error("LOCAL_CLEANUP_OPTIONS_INVALID");
  const evidencePath = join(
    options.evidenceDirectory,
    `cleanup-previous-${OWNER}.jsonl`,
  );
  await mkdir(options.evidenceDirectory, { recursive: true });
  const evidence = async (event: string, detail: Obj = {}) =>
    appendFile(
      evidencePath,
      `${JSON.stringify({ time: new Date().toISOString(), runId: OWNER, event, ...detail })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  await evidence("CLEANUP_STARTED", {
    journalSha256: JOURNAL_SHA256,
    daemonId: EXPECTED_DAEMON,
  });
  try {
    const journal = await readFile(JOURNAL);
    if (createHash("sha256").update(journal).digest("hex") !== JOURNAL_SHA256)
      throw new Error("PREVIOUS_JOURNAL_DIGEST_MISMATCH");
    const lines = journal
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Obj);
    const confirmed = lines.filter((line) => line.event === "CREATE_CONFIRMED");
    const release = lines.at(-1);
    const final = release?.snapshot as Obj | undefined;
    const state = final?.state as Obj | undefined;
    const configuration = final?.configuration as Obj | undefined;
    if (
      lines.length !== 72 ||
      release?.event !== "SUPERVISOR_RELEASED" ||
      release.hash !== RELEASE_HEAD ||
      release.owner !== OWNER ||
      release.runId !== "8337d702-629f-420d-8a87-0c3f2f31cd4e" ||
      release.token !== TOKEN ||
      !confirmed.some(
        (line) =>
          line.kind === "container" &&
          line.identity === CONTAINER_ID &&
          line.name === CONTAINER,
      ) ||
      !confirmed.some(
        (line) =>
          line.kind === "network" &&
          line.identity === NETWORK_ID &&
          line.name === NETWORK,
      ) ||
      !confirmed.some(
        (line) =>
          line.kind === "volume" &&
          line.identity === VOLUME_BIRTH &&
          line.name === VOLUME,
      ) ||
      state?.owner !== OWNER ||
      state.token !== TOKEN ||
      state.containerId !== CONTAINER_ID ||
      state.networkId !== NETWORK_ID ||
      state.volumeBirth !== VOLUME_BIRTH ||
      configuration?.daemonId !== EXPECTED_DAEMON ||
      configuration?.endpoint !== "npipe:////./pipe/docker_engine" ||
      configuration?.image !==
        "postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea" ||
      configuration?.resolvedImageId !==
        "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
    )
      throw new Error("PREVIOUS_JOURNAL_EVIDENCE_INCOMPLETE");
    const path = await realpath(options.dockerExecutable);
    const statPath = await lstat(options.dockerExecutable);
    if (
      !statPath.isFile() ||
      statPath.isSymbolicLink() ||
      path.toLowerCase() !== resolve(options.dockerExecutable).toLowerCase()
    )
      throw new Error("DOCKER_EXECUTABLE_IDENTITY_INVALID");
    const dockerHash = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (dockerHash !== DOCKER_SHA256)
      throw new Error("DOCKER_EXECUTABLE_HASH_MISMATCH");
    const identity = await stat(path);
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
    ])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    const command =
      options.transport ??
      (async (executable, args, timeoutMs, environment) => {
        try {
          const result = await exec(executable, [...args], {
            env: environment,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            code: 0,
            timedOut: false,
          };
        } catch (error) {
          const failure = error as {
            stdout?: unknown;
            stderr?: unknown;
            code?: unknown;
            killed?: unknown;
          };
          return {
            stdout: typeof failure.stdout === "string" ? failure.stdout : "",
            stderr: typeof failure.stderr === "string" ? failure.stderr : "",
            code: typeof failure.code === "number" ? failure.code : null,
            timedOut: failure.killed === true,
          };
        }
      });
    const invoke = async (args: string[]) => {
      const current = await stat(path);
      if (
        current.size !== identity.size ||
        current.mtimeMs !== identity.mtimeMs ||
        current.ino !== identity.ino ||
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex") !== DOCKER_SHA256
      )
        throw new Error("DOCKER_EXECUTABLE_IDENTITY_CHANGED");
      return command(
        path,
        ["--host", "npipe:////./pipe/docker_engine", ...args],
        30_000,
        env,
      );
    };
    const docker = async (args: string[]) => {
      const daemon = await invoke(["info", "--format", "{{.ID}}"]);
      if (
        daemon.timedOut ||
        daemon.code !== 0 ||
        daemon.stdout.trim() !== EXPECTED_DAEMON
      )
        throw new Error("PREVIOUS_RUN_DAEMON_IDENTITY_MISMATCH");
      const result = await invoke(args);
      if (result.timedOut || result.code !== 0)
        throw new Error("PREVIOUS_RUN_DOCKER_COMMAND_FAILED");
      return result.stdout.trim();
    };
    const inspect = async (
      kind: "container" | "network" | "volume",
      identity: string,
    ): Promise<Obj> => {
      const commandArgs =
        kind === "container"
          ? ["container", "inspect", identity]
          : kind === "network"
            ? ["network", "inspect", identity]
            : ["volume", "inspect", identity];
      const parsed: unknown = JSON.parse(await docker(commandArgs));
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 1 ||
        !parsed[0] ||
        typeof parsed[0] !== "object"
      )
        throw new Error("PREVIOUS_RUN_RESOURCE_INSPECTION_INVALID");
      const resource = parsed[0] as Obj;
      const labels = (
        kind === "container"
          ? (resource.Config as Obj | undefined)?.Labels
          : resource.Labels
      ) as Obj | undefined;
      if (
        !labels ||
        labels["stockwise.d5.owner"] !== OWNER ||
        labels["stockwise.d5.token"] !== TOKEN ||
        labels["stockwise.d5.role"] !== kind
      )
        throw new Error("PREVIOUS_RUN_OWNERSHIP_MISMATCH");
      if (
        kind === "container" &&
        (resource.Id !== CONTAINER_ID ||
          resource.Name !== `/${CONTAINER}` ||
          resource.Image !==
            "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea")
      )
        throw new Error("PREVIOUS_RUN_CONTAINER_IDENTITY_MISMATCH");
      if (
        kind === "volume" &&
        (resource.Name !== VOLUME ||
          resource.CreatedAt !== VOLUME_BIRTH ||
          resource.Driver !== "local" ||
          Object.keys((resource.Options as Obj | undefined) ?? {}).length)
      )
        throw new Error("PREVIOUS_RUN_VOLUME_IDENTITY_MISMATCH");
      if (
        kind === "network" &&
        (resource.Id !== NETWORK_ID || resource.Name !== NETWORK)
      )
        throw new Error("PREVIOUS_RUN_NETWORK_IDENTITY_MISMATCH");

      return resource;
    };
    const ensureAbsent = async (kind: "container" | "network" | "volume") => {
      const output =
        kind === "container"
          ? await docker([
              "ps",
              "--all",
              "--no-trunc",
              "--format",
              "{{.ID}}|{{.Names}}",
            ])
          : kind === "network"
            ? await docker([
                "network",
                "ls",
                "--no-trunc",
                "--format",
                "{{.ID}}|{{.Name}}",
              ])
            : await docker(["volume", "ls", "--format", "{{.Name}}"]);
      const name =
        kind === "container"
          ? CONTAINER
          : kind === "network"
            ? NETWORK
            : VOLUME;
      const identity =
        kind === "container"
          ? CONTAINER_ID
          : kind === "network"
            ? NETWORK_ID
            : name;
      if (
        output
          .split(/\r?\n/)
          .some(
            (line) =>
              line.split("|")[0] === identity || line.split("|")[1] === name,
          )
      )
        throw new Error("PREVIOUS_RUN_RESOURCE_STILL_PRESENT");
    };
    const container = await inspect("container", CONTAINER_ID);
    const network = await inspect("network", NETWORK_ID);
    await inspect("volume", VOLUME);
    const hostConfig = container.HostConfig as Obj | undefined;
    const networkSettings = container.NetworkSettings as Obj | undefined;
    const networkMap = networkSettings?.Networks as Obj | undefined;
    const mounts = container.Mounts as Obj[] | undefined;
    const members = Object.keys((network.Containers as Obj | undefined) ?? {});
    if (
      container.Id !== CONTAINER_ID ||
      container.Name !== `/${CONTAINER}` ||
      container.Image !==
        "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea" ||
      hostConfig?.NetworkMode !== NETWORK_ID ||
      Object.keys((hostConfig?.PortBindings as Obj | undefined) ?? {})
        .length !== 0 ||
      (Array.isArray(hostConfig?.Binds) && hostConfig!.Binds.length !== 0) ||
      Object.keys(networkMap ?? {}).length !== 1 ||
      !networkMap?.[NETWORK] ||
      ((networkMap[NETWORK] as Obj).NetworkID !== NETWORK_ID &&
        !(
          (container.State as Obj | undefined)?.Status === "created" &&
          (networkMap[NETWORK] as Obj).NetworkID === ""
        )) ||
      !Array.isArray(mounts) ||
      mounts.length !== 1 ||
      mounts[0]?.Type !== "volume" ||
      mounts[0]?.Name !== VOLUME ||
      mounts[0]?.Destination !== "/var/lib/postgresql/data" ||
      mounts[0]?.RW !== true ||
      members.some((id) => id !== CONTAINER_ID) ||
      !network.Internal ||
      network.Driver !== "bridge"
    )
      throw new Error("PREVIOUS_RUN_RESOURCE_CONFIGURATION_MISMATCH");
    const volumeUsers = await docker([
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `volume=${VOLUME}`,
      "--format",
      "{{.ID}}",
    ]);
    if (volumeUsers !== CONTAINER_ID)
      throw new Error("PREVIOUS_RUN_VOLUME_HAS_ATTACHMENTS");
    const initialState = container.State as Obj | undefined;
    if (initialState?.Running === true)
      await docker(["container", "stop", "--time", "5", CONTAINER_ID]);
    const stopped = await inspect("container", CONTAINER_ID);
    if ((stopped.State as Obj | undefined)?.Running === true)
      throw new Error("PREVIOUS_RUN_CONTAINER_STOP_FAILED");
    await docker(["container", "rm", CONTAINER_ID]);
    await ensureAbsent("container");
    await evidence("RESOURCE_REMOVED", { kind: "container", id: CONTAINER_ID });
    const detachedNetwork = await inspect("network", NETWORK_ID);
    if (
      Object.keys((detachedNetwork.Containers as Obj | undefined) ?? {}).length
    )
      throw new Error("PREVIOUS_RUN_NETWORK_HAS_ATTACHMENTS");
    await docker(["network", "rm", NETWORK_ID]);
    await ensureAbsent("network");
    await evidence("RESOURCE_REMOVED", { kind: "network", id: NETWORK_ID });
    await inspect("volume", VOLUME);
    const remainingVolumeUsers = await docker([
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `volume=${VOLUME}`,
      "--format",
      "{{.ID}}",
    ]);
    if (remainingVolumeUsers)
      throw new Error("PREVIOUS_RUN_VOLUME_HAS_ATTACHMENTS");
    await docker(["volume", "rm", VOLUME]);
    await ensureAbsent("volume");
    await evidence("RESOURCE_REMOVED", {
      kind: "volume",
      name: VOLUME,
      createdAt: VOLUME_BIRTH,
    });
    await evidence("CLEANUP_COMPLETED", { verdict: "PASS" });
  } catch (error) {
    await evidence("CLEANUP_FAILED", {
      verdict: "FAIL",
      error: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
    }).catch(() => undefined);
    throw error;
  }
}
