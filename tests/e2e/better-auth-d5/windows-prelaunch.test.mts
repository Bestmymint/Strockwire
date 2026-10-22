import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import type { WindowsPrelaunchApproval } from "./windows-prelaunch.mts";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const cleanEnvironment: NodeJS.ProcessEnv = {};
for (const key of [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
])
  if (process.env[key] !== undefined) cleanEnvironment[key] = process.env[key];
let root: string;
let approval: WindowsPrelaunchApproval;
let observedPath: string;
let helperPath: string;
let parserPath: string;
const sourceFiles = [
  "migration-contract.mts",
  "source-contract.mts",
  "windows-launch.mts",
  "windows-module-closure.mts",
  "windows-prelaunch.mts",
  "windows-source.mts",
];
before(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), "d5 prelaunch-"));
  const verifier = join(root, "verifier"),
    supervisor = join(root, "supervisor");
  await mkdir(join(verifier, "node_modules/typescript/lib"), {
    recursive: true,
  });
  await mkdir(supervisor);
  await mkdir(join(root, "candidate"));
  for (const file of sourceFiles)
    await copyFile(join(sourceRoot, file), join(verifier, file));
  const parserFiles = ["package.json", "lib/typescript.js"];
  for (const file of parserFiles)
    await copyFile(
      resolve(sourceRoot, "../../../node_modules/typescript", file),
      join(verifier, "node_modules/typescript", file),
    );
  parserPath = join(verifier, "node_modules/typescript/lib/typescript.js");
  observedPath = join(supervisor, "observed.json");
  helperPath = join(supervisor, "helper.mts");
  const helper = "export const value = 7;\n";
  const entry =
    'import /* closure-required */ "./helper.mts";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./observed.json", import.meta.url), JSON.stringify({execArgv:process.execArgv,argv:process.argv,cwd:process.cwd()}));\n';
  await writeFile(helperPath, helper);
  await writeFile(join(supervisor, "entry.mts"), entry);
  const files = [];
  for (const file of [
    ...sourceFiles,
    ...parserFiles.map((p) => `node_modules/typescript/${p}`),
  ])
    files.push({
      path: file,
      sha256: hash(await readFile(join(verifier, file))),
    });
  approval = {
    contract: "D5-WINDOWS-PRELAUNCH-v1",
    candidateRoot: join(root, "candidate"),
    verifier: { root: verifier, entryModule: "windows-prelaunch.mts", files },
    pin: {
      root: supervisor,
      workingDirectory: supervisor,
      nodeExecutable: process.execPath,
      nodeExecutableSha256: hash(await readFile(process.execPath)),
      entryModule: "entry.mts",
      invocationMode: "file",
      execArgv: [],
      closure: [
        {
          path: "entry.mts",
          sha256: hash(entry),
          imports: ["helper.mts", "node:fs"],
        },
        { path: "helper.mts", sha256: hash(helper), imports: [] },
      ],
    },
  };
});
after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function invoke(
  value: unknown,
  options: { digest?: string; environment?: NodeJS.ProcessEnv } = {},
) {
  await rm(observedPath, { force: true });
  const bytes = JSON.stringify(value),
    authority = join(root, "approval.json");
  await writeFile(authority, bytes);
  const script = join(sourceRoot, "windows-trusted-launch.cmd");
  const command = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/cmd.exe",
  );
  const args = ["/d", "/c", script];
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult) => {
      execFile(
        command,
        args,
        {
          env: {
            ...cleanEnvironment,
            STOCKWISE_D5_LAUNCH_APPROVAL_PATH: authority,
            STOCKWISE_D5_LAUNCH_APPROVAL_SHA256: options.digest ?? hash(bytes),
            ...options.environment,
          },
          windowsHide: true,
          shell: false,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolveResult({
            code: error
              ? typeof error.code === "number"
                ? error.code
                : null
              : 0,
            stdout,
            stderr,
          });
        },
      );
    },
  );
}
async function refused(value: unknown, options?: Parameters<typeof invoke>[1]) {
  const result = await invoke(value, options);
  assert.equal(result.code, 1, result.stderr);
  await assert.rejects(readFile(observedPath), { code: "ENOENT" });
  assert.match(result.stderr, /WINDOWS_(?:NATIVE_LAUNCH|PRELAUNCH)_REFUSED/);
}

test("native launcher rejects every unapproved Node flag spelling and execution mode before supervisor execution", async () => {
  for (const args of [
    ["--require", "x.mts"],
    ["-r", "x.mts"],
    ["--require=x.mts"],
    ["--import", "x.mts"],
    ["--import=x.mts"],
    ["--loader", "x.mts"],
    ["--experimental-loader=x.mts"],
    ["--experimental_loader=x.mts"],
    ["--eval", "0"],
    ["-e", "0"],
    ["--print=0"],
    ["-p", "0"],
    ["--conditions=other"],
    ["--experimental-policy=x.json"],
    ["--"],
    ["--no-warnings"],
  ]) {
    const value = structuredClone(approval);
    value.pin.execArgv = args;
    await refused(value);
  }
  await refused({
    ...approval,
    pin: { ...approval.pin, invocationMode: "eval" },
  });
});

test("native launcher strips inherited credentials and Node injection before Node startup", async () => {
  const marker = join(root, "preload-executed");
  const preload = join(root, "preload.cjs");
  await writeFile(
    preload,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe');`,
  );
  for (const name of [
    "NODE_OPTIONS",
    "node_options",
    "NODE_PATH",
    "TSX_TSCONFIG_PATH",
    "DATABASE_URL",
    "PGHOST",
    "OPENROUTER_API_KEY",
  ]) {
    const result = await invoke(approval, {
      environment: { [name]: `--require=${preload}` },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      stage: "SUPERVISOR_EXIT",
      exitCode: 0,
    });
    assert.ok(!result.stdout.includes(preload));
    assert.ok(!result.stderr.includes(preload));
  }
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("native allowlist confines synthetic secrets and overrides through child and grandchild environments", async () => {
  const entryPath = join(approval.pin.root, "entry.mts");
  const original = await readFile(entryPath);
  const source = `import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const descendant = execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort()))"], {encoding:"utf8"});
writeFileSync(new URL("./observed.json", import.meta.url), JSON.stringify({keys:Object.keys(process.env).sort(), descendant:JSON.parse(descendant)}));
`;
  const sentinel = 'synthetic-only-!%&|<>^"credential';
  const controls = {
    STOCKWISE_D5_CLI_APPROVAL_PATH: join(root, "cli.json"),
    STOCKWISE_D5_CLI_APPROVAL_SHA256: "a".repeat(64),
    STOCKWISE_D5_SUPERVISOR_PLAN_PATH: join(root, "plan.json"),
    STOCKWISE_D5_SUPERVISOR_PLAN_SHA256: "b".repeat(64),
  };
  try {
    await writeFile(entryPath, source);
    const value = structuredClone(approval);
    value.pin.closure = [
      {
        path: "entry.mts",
        sha256: hash(source),
        imports: ["node:child_process", "node:fs"],
      },
    ];
    const result = await invoke(value, {
      environment: {
        ...controls,
        OPENROUTER_API_KEY: sentinel,
        DATABASE_URL: sentinel,
        PGHOST: sentinel,
        DOCKER_HOST: sentinel,
        NODE_OPTIONS: "--require=must-never-load.cjs",
        UNRELATED_SETTING: sentinel,
      },
    });
    assert.equal(result.code, 0, result.stderr);
    const observed = JSON.parse(await readFile(observedPath, "utf8"));
    const expected = [
      ...Object.keys(cleanEnvironment),
      ...Object.keys(controls),
      "STOCKWISE_D5_LAUNCH_APPROVAL_PATH",
      "STOCKWISE_D5_LAUNCH_APPROVAL_SHA256",
    ].sort();
    assert.deepEqual(observed.keys, expected);
    assert.deepEqual(observed.descendant, expected);
    assert.ok(!result.stdout.includes(sentinel));
    assert.ok(!result.stderr.includes(sentinel));
    assert.ok(!(await readFile(observedPath, "utf8")).includes(sentinel));
  } finally {
    await writeFile(entryPath, original);
  }
});

test("prelaunch still rejects a secret injected into its actual isolated environment", async () => {
  await rm(observedPath, { force: true });
  const authority = join(root, "isolated-approval.json");
  const bytes = JSON.stringify(approval);
  await writeFile(authority, bytes);
  for (const key of [
    "OPENROUTER_API_KEY",
    "DATABASE_URL",
    "PGHOST",
    "DOCKER_HOST",
  ]) {
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((done) => {
      execFile(
        process.execPath,
        [
          join(approval.verifier.root, approval.verifier.entryModule),
          authority,
          hash(bytes),
        ],
        {
          env: { ...cleanEnvironment, [key]: "synthetic-isolated-secret" },
          shell: false,
          timeout: 30_000,
        },
        (error, stdout, stderr) =>
          done({
            code: error
              ? typeof error.code === "number"
                ? error.code
                : null
              : 0,
            stdout,
            stderr,
          }),
      );
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /WINDOWS_PRELAUNCH_REFUSED/);
    assert.ok(!result.stdout.includes("synthetic-isolated-secret"));
    assert.ok(!result.stderr.includes("synthetic-isolated-secret"));
    await assert.rejects(readFile(observedPath), { code: "ENOENT" });
  }
});

test("native launcher refuses missing substituted approval and candidate-controlled verifier or executable", async () => {
  await refused(approval, { digest: "0".repeat(64) });
  await refused(null);
  await refused({ ...approval, candidateRoot: approval.verifier.root });
  await refused({
    ...approval,
    candidateRoot: dirname(approval.pin.nodeExecutable),
  });
  await refused({
    ...approval,
    verifier: { ...approval.verifier, entryModule: "candidate.mts" },
  });
});

test("pre-execution verifier rejects changed Node identity entrypoint closure inventory and working directory", async () => {
  for (const change of [
    { nodeExecutableSha256: "0".repeat(64) },
    { nodeExecutable: join(root, "candidate/node.exe") },
    { entryModule: "helper.mts" },
    { workingDirectory: join(root, "candidate") },
    { closure: approval.pin.closure.slice(0, 1) },
    {
      closure: [
        ...approval.pin.closure,
        { path: "extra.mts", sha256: "0".repeat(64), imports: [] },
      ],
    },
  ])
    await refused({ ...approval, pin: { ...approval.pin, ...change } });
});

test("native launcher hashes verifier and approved parser bytes before any verifier code starts", async () => {
  const original = await readFile(parserPath);
  const marker = join(root, "parser-executed");
  try {
    await writeFile(
      parserPath,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe');`,
    );
    await refused(approval);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await writeFile(parserPath, original);
  }
});

test("syntax preflight rejects hidden changed dependency bytes before supervisor execution", async () => {
  const original = await readFile(helperPath);
  try {
    await writeFile(helperPath, "export const value = 9;\n");
    await refused(approval);
  } finally {
    await writeFile(helperPath, original);
  }
});

test("native syntax preflight rejects reviewed commented dynamic import bytes before dispatch", async () => {
  const entry = join(approval.pin.root, "entry.mts");
  const original = await readFile(entry);
  try {
    const source = 'import /* forbidden dynamic loader */ ("./helper.mts");\n';
    await writeFile(entry, source);
    const value = structuredClone(approval);
    value.pin.closure = value.pin.closure.map((file) =>
      file.path === "entry.mts" ? { ...file, sha256: hash(source) } : file,
    );
    await refused(value);
  } finally {
    await writeFile(entry, original);
  }
});

test("valid approved native launch traverses parser verifier and exact zero-flag Node supervisor chain", async () => {
  const result = await invoke(approval);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    stage: "SUPERVISOR_EXIT",
    exitCode: 0,
  });
  const observed = JSON.parse(await readFile(observedPath, "utf8"));
  assert.deepEqual(observed, {
    execArgv: [],
    argv: [process.execPath, join(approval.pin.root, "entry.mts")],
    cwd: approval.pin.workingDirectory,
  });
});
test("syntax preflight refuses loader-capability aliases with the exact reviewed entry pin", async () => {
  const entryPath = join(approval.pin.root, "entry.mts");
  const loaderPath = join(approval.pin.root, "untracked-loader.mjs");
  const markerPath = join(approval.pin.root, "loader-marker");
  const originalEntry = await readFile(entryPath);
  const loader = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./loader-marker", import.meta.url), "executed");\n`;
  const cases = [
    `const builtin = process.getBuiltinModule.bind(process); const { register: loadHooks } = builtin("module"); loadHooks("./untracked-loader.mjs", import.meta.url);`,
    `const getBuiltin = process.getBuiltinModule; const moduleBuiltin = getBuiltin("module"); moduleBuiltin.register("./untracked-loader.mjs", import.meta.url);`,
    `let builtin; builtin = process.getBuiltinModule.bind(process); builtin("module").register("./untracked-loader.mjs", import.meta.url);`,
    `const { getBuiltinModule: getBuiltin } = process; getBuiltin("module").register("./untracked-loader.mjs", import.meta.url);`,
    `process["getBuiltinModule"]("module").register("./untracked-loader.mjs", import.meta.url);`,
    `process.getBuiltinModule?.("module").register("./untracked-loader.mjs", import.meta.url);`,
    `Reflect.get(process, "getBuiltinModule")("module").register("./untracked-loader.mjs", import.meta.url);`,
    `Object.getOwnPropertyDescriptor(process, "getBuiltinModule").value("module").register("./untracked-loader.mjs", import.meta.url);`,
    `import { register as loadHooks } from "node:module"; loadHooks("./untracked-loader.mjs", import.meta.url);`,
    `import * as Module from "node:module"; Module.register("./untracked-loader.mjs", import.meta.url);`,
  ];
  try {
    await writeFile(loaderPath, loader);

    for (const capability of cases) {
      await rm(markerPath, { force: true });
      const imports = capability.includes(`from "node:module"`)
        ? ["helper.mts", "node:fs", "node:module"]
        : ["helper.mts", "node:fs"];
      const source = `import "./helper.mts";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./observed.json", import.meta.url), "DISPATCHED");\n${capability}\n`;
      await writeFile(entryPath, source);
      const value = structuredClone(approval);
      value.pin.closure = [
        { path: "entry.mts", sha256: hash(source), imports },
        {
          path: "helper.mts",
          sha256: hash(await readFile(helperPath)),
          imports: [],
        },
      ];
      await refused(value);
      await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    }

    const source = `import { value as importedValue } from "./helper.mts";\nimport { writeFileSync } from "node:fs";\nconst register = () => 1;\nfunction registerHooks() { return 2; }\nconst ordinary = { register() { return 3; }, registerHooks() { return 4; } };\nwriteFileSync(new URL("./observed.json", import.meta.url), JSON.stringify({ value: importedValue, registrations: [register(), registerHooks(), ordinary.register(), ordinary.registerHooks()], execArgv: process.execArgv, argv: process.argv, cwd: process.cwd() }));\n`;
    await writeFile(entryPath, source);
    const value = structuredClone(approval);
    value.pin.closure[0] = {
      path: "entry.mts",
      sha256: hash(source),
      imports: ["helper.mts", "node:fs"],
    };
    const result = await invoke(value);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      stage: "SUPERVISOR_EXIT",
      exitCode: 0,
    });
    assert.deepEqual(JSON.parse(await readFile(observedPath, "utf8")), {
      value: 7,
      registrations: [1, 2, 3, 4],
      execArgv: [],
      argv: [process.execPath, entryPath],
      cwd: approval.pin.workingDirectory,
    });
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  } finally {
    await writeFile(entryPath, originalEntry);
    await rm(loaderPath, { force: true });
    await rm(markerPath, { force: true });
  }
});

test("loader-capability aliases refuse a changed untracked loader under the unchanged closure pin", async () => {
  const entryPath = join(approval.pin.root, "entry.mts");
  const loaderPath = join(approval.pin.root, "untracked-loader.mjs");
  const markerPath = join(approval.pin.root, "loader-marker");
  const originalEntry = await readFile(entryPath);
  const source = `import "./helper.mts";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./observed.json", import.meta.url), "DISPATCHED");\nconst builtin = process.getBuiltinModule.bind(process); const { register: loadHooks } = builtin("module"); loadHooks("./untracked-loader.mjs", import.meta.url);\n`;
  const initialLoader = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./loader-marker", import.meta.url), "initial");\n`;
  const mutatedLoader = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./loader-marker", import.meta.url), "mutated");\n`;
  try {
    await writeFile(entryPath, source);
    await writeFile(loaderPath, initialLoader);
    const value = structuredClone(approval);
    value.pin.closure = [
      {
        path: "entry.mts",
        sha256: hash(source),
        imports: ["helper.mts", "node:fs"],
      },
      {
        path: "helper.mts",
        sha256: hash(await readFile(helperPath)),
        imports: [],
      },
    ];
    await refused(value);
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    await writeFile(loaderPath, mutatedLoader);
    await refused(value);
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  } finally {
    await writeFile(entryPath, originalEntry);
    await rm(loaderPath, { force: true });
    await rm(markerPath, { force: true });
  }
});

test("pre-execution verifier rejects missing and mismatched closure pins", async () => {
  await refused({
    contract: approval.contract,
    candidateRoot: approval.candidateRoot,
    verifier: approval.verifier,
  });
  const mismatched = structuredClone(approval);
  mismatched.pin.closure = mismatched.pin.closure.map((file) =>
    file.path === "helper.mts" ? { ...file, sha256: "0".repeat(64) } : file,
  );
  await refused(mismatched);
});

test("matching native pins refuse computed constructor aliases before dispatch or untracked loader execution", async () => {
  const entryPath = join(approval.pin.root, "entry.mts");
  const loaderPath = join(approval.pin.root, "untracked-loader.mjs");
  const markerPath = join(approval.pin.root, "loader-marker");
  const originalEntry = await readFile(entryPath);
  // Unlike the scanner-only exact Codex URL, executable probes target owned temp files only.
  const body = `process.getBuiltinModule("module").register(${JSON.stringify(pathToFileURL(loaderPath).href)})`;
  const cases = [
    `const compile = (() => {})["con" + "structor"];`,
    `const key = "constructor"; const compile = (() => {})[key];`,
    `const compile = (() => {})[["con", "structor"].join("")];`,
    `const compile = (() => {})[("con" + "structor")];`,
    'const compile = (() => {})[`con${"structor"}`];',
    `const compile = ((() => {}))?.["con" + "structor"];`,
    `const compile = ({fn: () => {}})["fn"]["con" + "structor"];`,
    `let compile; compile = (() => {})["con" + "structor"];`,
    `const {["con" + "structor"]: compile} = (() => {});`,
    `const {constructor: compile} = (() => {});`,
    `const {constructor} = (() => {}); const compile = constructor;`,
    `const compile = (async () => {})["con" + "structor"];`,
    `let compile; ({constructor: compile} = (() => {}));`,
    `let compile; ({nested: {constructor: compile}} = {nested: () => {}});`,
    `let compile; ([{constructor: compile}] = [() => {}]);`,
    `let compile; for ({constructor: compile} of [() => {}]) {}`,
  ];
  try {
    await writeFile(
      loaderPath,
      `import {writeFileSync} from "node:fs";\nwriteFileSync(new URL("./loader-marker", import.meta.url), "executed");\n`,
    );
    for (const acquisition of cases) {
      await rm(markerPath, { force: true });
      const source = `import "./helper.mts";\nimport {writeFileSync} from "node:fs";\nwriteFileSync(new URL("./observed.json", import.meta.url), "DISPATCHED");\n${acquisition}\ncompile(${JSON.stringify(body)})();\n`;
      await writeFile(entryPath, source);
      const value = structuredClone(approval);
      value.pin.closure = [
        {
          path: "entry.mts",
          sha256: hash(source),
          imports: ["helper.mts", "node:fs"],
        },
        {
          path: "helper.mts",
          sha256: hash(await readFile(helperPath)),
          imports: [],
        },
      ];
      await refused(value);
      await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    }
  } finally {
    await writeFile(entryPath, originalEntry);
    await rm(loaderPath, { force: true });
    await rm(markerPath, { force: true });
  }
});

test("native prelaunch admits literal indexed data ordinary register aliases and static reexports", async () => {
  const entryPath = join(approval.pin.root, "entry.mts");
  const originalEntry = await readFile(entryPath);
  const source = `import {value} from "./helper.mts";
export {value} from "./helper.mts";
import {writeFileSync} from "node:fs";
const data = {value};
const values = [value];
const ordinary = {register() {return 9;}};
const register = ordinary["register"];
writeFileSync(new URL("./observed.json", import.meta.url), JSON.stringify({literal: data["value"], template: data[\`value\`], numeric: values[0], registered: register(), execArgv: process.execArgv}));
`;
  try {
    await writeFile(entryPath, source);
    const value = structuredClone(approval);
    value.pin.closure[0] = {
      path: "entry.mts",
      sha256: hash(source),
      imports: ["helper.mts", "node:fs"],
    };
    const result = await invoke(value);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      stage: "SUPERVISOR_EXIT",
      exitCode: 0,
    });
    assert.deepEqual(JSON.parse(await readFile(observedPath, "utf8")), {
      literal: 7,
      template: 7,
      numeric: 7,
      registered: 9,
      execArgv: [],
    });
  } finally {
    await writeFile(entryPath, originalEntry);
  }
});
