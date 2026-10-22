import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  withLocalPostgres,
  verifyLocalPostgresReceipt,
  type LocalDockerTransport,
  type LocalPostgresConnection,
} from "./local-runner.mts";

const IMAGE =
  "postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const IMAGE_ID = `sha256:${"c".repeat(64)}`;
const NETWORK_ID = "a".repeat(64);
const CONTAINER_ID = "b".repeat(64);
type Callback = (connection: LocalPostgresConnection) => Promise<unknown>;
const run = async (
  directory: string,
  transport: LocalDockerTransport,
  callback: Callback,
  runTimeoutMs = 60_000,
) => {
  const dockerExecutable = join(directory, "docker.exe");
  await writeFile(dockerExecutable, "synthetic docker executable");
  return withLocalPostgres(
    {
      image: IMAGE,
      dockerExecutable,
      evidenceDirectory: directory,
      runTimeoutMs,
      cleanupGraceMs: 10,
      transport,
    },
    callback,
  );
};

function makeTransport(
  config: { ownerMismatch?: boolean; cleanupFailure?: boolean } = {},
) {
  const history: string[][] = [];
  const labels = new Map<string, Record<string, string>>();
  let networkName = "";
  let volumeName = "";
  let containerName = "";
  let passwordEntry = "";
  let containerRunning = false;
  const transport: LocalDockerTransport = async (
    _exe,
    supplied,
    _timeout,
    environment,
  ) => {
    const args = supplied.slice(2);
    history.push([...args]);
    assert.equal(environment.DATABASE_URL, undefined);
    assert.equal(environment.TEST_DATABASE_URL, undefined);
    assert.equal(environment.OPENROUTER_API_KEY, undefined);
    const result = (stdout = "") => ({
      stdout,
      stderr: "",
      code: 0,
      timedOut: false,
    });
    if (config.cleanupFailure && args[0] === "container" && args[1] === "rm")
      return {
        stdout: "",
        stderr: "synthetic removal refusal",
        code: 1,
        timedOut: false,
      };
    if (args[0] === "info" && args[1] === "--format")
      return result("34b7f6a0-e608-44c1-bca5-11c60dd363b9");
    if (args[0] === "image" && args[1] === "inspect")
      return result(
        JSON.stringify([
          {
            Id: IMAGE_ID,
            Os: "linux",
            Architecture: "amd64",
            Config: { Env: ["PG_MAJOR=16", "PG_VERSION=16.15"] },
            RepoDigests: [`postgres@${IMAGE.slice(IMAGE.indexOf("@") + 1)}`],
            RepoTags: ["postgres:16.15-alpine"],
          },
        ]),
      );
    if (args[0] === "network" && args[1] === "create") {
      networkName = args.at(-1)!;
      labels.set(networkName, extractLabels(args));
      return result(NETWORK_ID);
    }
    if (args[0] === "volume" && args[1] === "create") {
      volumeName = args.at(-1)!;
      labels.set(volumeName, extractLabels(args));
      return result(volumeName);
    }
    if (args[0] === "container" && args[1] === "create") {
      containerName = args[args.indexOf("--name") + 1]!;
      passwordEntry = args.find((value) =>
        value.startsWith("POSTGRES_PASSWORD="),
      )!;
      labels.set(containerName, extractLabels(args));
      assert.ok(args.includes("--pull=never"));
      assert.ok(args.includes("--cpus=2"));
      assert.ok(args.includes("--memory=1g"));
      assert.ok(args.includes("--pids-limit=128"));
      return result(CONTAINER_ID);
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const resourceLabels = labels.get(containerName) ?? {};
      return result(
        JSON.stringify([
          {
            Id: CONTAINER_ID,
            Name: `/${containerName}`,
            Image: IMAGE_ID,
            Config: {
              Image: IMAGE,
              User: "postgres",
              Labels: {
                ...resourceLabels,
                ...(config.ownerMismatch
                  ? { "stockwise.local.owner": "foreign" }
                  : {}),
              },
              Env: [
                "POSTGRES_USER=stockwise_test",
                "POSTGRES_DB=stockwise_test",
                passwordEntry,
              ],
            },
            HostConfig: {
              Memory: 1024 ** 3,
              MemorySwap: 1024 ** 3,
              NanoCpus: 2_000_000_000,
              PidsLimit: 128,
              ReadonlyRootfs: true,
              Privileged: false,
              NetworkMode: networkName,
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges"],
              RestartPolicy: { Name: "no" },
              Tmpfs: { "/tmp": "rw", "/var/run/postgresql": "rw" },
              PortBindings: {
                "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }],
              },
            },
            Mounts: [
              {
                Type: "volume",
                Name: volumeName,
                Destination: "/var/lib/postgresql/data",
                RW: true,
              },
              { Type: "tmpfs", Destination: "/tmp", RW: true },
              { Type: "tmpfs", Destination: "/var/run/postgresql", RW: true },
            ],
            NetworkSettings: {
              Networks: { [networkName]: { NetworkID: NETWORK_ID } },
              Ports: {
                "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "45678" }],
              },
            },
            State: { Running: containerRunning },
          },
        ]),
      );
    }
    if (args[0] === "container" && args[1] === "start") containerRunning = true;
    if (args[0] === "container" && args[1] === "stop") containerRunning = false;
    if (args[0] === "network" && args[1] === "inspect")
      return result(
        JSON.stringify([
          {
            Id: NETWORK_ID,
            Name: networkName,
            Labels: {
              ...(labels.get(networkName) ?? {}),
              ...(config.ownerMismatch
                ? { "stockwise.local.owner": "foreign" }
                : {}),
            },
            Driver: "bridge",
            Internal: false,
            Containers: {},
          },
        ]),
      );
    if (args[0] === "volume" && args[1] === "inspect")
      return result(
        JSON.stringify([
          {
            Name: volumeName,
            CreatedAt: "2026-10-22T00:00:00Z",
            Driver: "local",
            Labels: labels.get(volumeName) ?? {},
          },
        ]),
      );
    if (args[0] === "exec" && args.includes("SELECT 1")) return result("1");
    return result();
  };
  return { transport, history };
}
function extractLabels(args: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (let index = 0; index < args.length - 1; index++)
    if (args[index] === "--label") {
      const [key, ...value] = args[index + 1]!.split("=");
      labels[key!] = value.join("=");
    }
  return labels;
}
async function temporaryEvidence(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}
async function journalAt(directory: string): Promise<string> {
  const name = (await readdir(directory)).find((file) =>
    file.endsWith(".jsonl"),
  );
  assert.ok(name);
  return readFile(join(directory, name), "utf8");
}

test("receipt is tied to both local disposable databases", () => {
  const receipt = {
    owner: "f8a651a0-f35f-4793-b191-09f7d1dceb4d",
    runId: "8337d702-629f-420d-8a87-0c3f2f31cd4e",
    database: "stockwise_test",
    testDatabase: "stockwise_test_test",
    host: "127.0.0.1",
    port: "5432",
    marker: "A".repeat(43),
  } as const;
  assert.equal(
    verifyLocalPostgresReceipt(
      receipt,
      "postgresql://u:p@127.0.0.1:5432/stockwise_test",
      "postgresql://u:p@127.0.0.1:5432/stockwise_test_test",
    ),
    true,
  );
  assert.equal(
    verifyLocalPostgresReceipt(
      receipt,
      "postgresql://u:p@127.0.0.1:5432/other",
      "postgresql://u:p@127.0.0.1:5432/stockwise_test_test",
    ),
    false,
  );
  assert.equal(
    verifyLocalPostgresReceipt(
      receipt,
      "postgresql://u:p@10.0.0.4:5432/stockwise_test",
      "postgresql://u:p@10.0.0.4:5432/stockwise_test_test",
    ),
    false,
  );
});

test("secrets stay out of child environment and journal, and cleanup removes container before dependencies", async () => {
  const directory = await temporaryEvidence("stockwise-local-runner-");
  const { transport, history } = makeTransport();
  const secret = "synthetic-parent-secret-not-for-journal";
  const originals = [
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    process.env.OPENROUTER_API_KEY,
  ];
  process.env.DATABASE_URL = secret;
  process.env.TEST_DATABASE_URL = secret;
  process.env.OPENROUTER_API_KEY = secret;
  try {
    await run(directory, transport, async (connection) => {
      assert.equal(
        verifyLocalPostgresReceipt(
          connection.receipt,
          connection.DATABASE_URL,
          connection.TEST_DATABASE_URL,
        ),
        true,
      );
      assert.notEqual(connection.DATABASE_URL, connection.TEST_DATABASE_URL);
    });
    assert.equal((await journalAt(directory)).includes(secret), false);
    const removals = history
      .filter((args) => args.at(-2) === "rm")
      .map((args) => args[0]);
    assert.equal(removals[0], "container");
    assert.deepEqual(
      new Set(removals),
      new Set(["container", "network", "volume"]),
    );
  } finally {
    for (const [key, value] of [
      ["DATABASE_URL", originals[0]],
      ["TEST_DATABASE_URL", originals[1]],
      ["OPENROUTER_API_KEY", originals[2]],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("ownership mismatch prevents deletion of a possibly foreign resource", async () => {
  const directory = await temporaryEvidence("stockwise-local-owner-mismatch-");
  const { transport, history } = makeTransport({ ownerMismatch: true });
  try {
    await assert.rejects(
      run(directory, transport, async () => undefined),
      /RESOURCE_OWNERSHIP_MISMATCH/,
    );
    assert.equal(
      history.some((args) => args[0] === "network" && args[1] === "rm"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("callback errors and timeouts never record PASS", async (t) => {
  await t.test("callback error", async () => {
    const directory = await temporaryEvidence("stockwise-local-failure-");
    try {
      await assert.rejects(
        run(directory, makeTransport().transport, async () => {
          throw new Error("synthetic callback failure");
        }),
        /synthetic callback failure/,
      );
      const journal = await journalAt(directory);
      assert.match(journal, /"event":"RUN_FINISHED","verdict":"FAIL"/);
      assert.doesNotMatch(
        journal,
        /"event":"CALLBACK_COMPLETED","verdict":"PASS"/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  await t.test("timeout", async () => {
    const directory = await temporaryEvidence("stockwise-local-timeout-");
    try {
      let signalAborted = false;
      await assert.rejects(
        run(
          directory,
          makeTransport().transport,
          (connection) => {
            connection.signal.addEventListener("abort", () => {
              signalAborted = true;
            });
            return new Promise(() => undefined);
          },
          5,
        ),
        /LOCAL_TEST_RUN_TIMED_OUT/,
      );
      assert.equal(signalAborted, true);
      const journal = await journalAt(directory);
      assert.match(journal, /"event":"RUN_FINISHED","verdict":"FAIL"/);
      assert.doesNotMatch(
        journal,
        /"event":"CALLBACK_COMPLETED","verdict":"PASS"/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("cleanup failure remains failed even after the callback succeeds", async () => {
  const directory = await temporaryEvidence("stockwise-local-cleanup-failure-");
  try {
    await assert.rejects(
      run(
        directory,
        makeTransport({ cleanupFailure: true }).transport,
        async () => true,
      ),
      /DOCKER_COMMAND_FAILED_1/,
    );
    const journal = await journalAt(directory);
    assert.match(
      journal,
      /"event":"RUN_FINISHED","verdict":"FAIL","cleanup":"INCOMPLETE"/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
