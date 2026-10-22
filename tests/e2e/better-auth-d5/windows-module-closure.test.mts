import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { captureWindowsModuleClosure } from "./windows-module-closure.mts";

const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
async function fixture(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(resolve(tmpdir(), "windows-module-closure-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const destination = resolve(root, path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, source);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("captures exact sorted hashes and recursively closes multiline imports, re-exports, type imports and cycles", async () => {
  const files = {
    "entry.mts": `// import "./comment-only.mts";\nimport\n  type { Shape }\n  from "./shared.mts";\nimport "node:crypto";\nexport { value }\n  from "./nested/re-export.mts";\nexport * as helpers from "./nested/re-export.mts";\nexport type { Shape };\ntype Query = import /* type-query dependency */ ("./query.mts").Query;\n`,
    "shared.mts": `import "./nested/re-export.mts";\nexport type interfaceShape = string;\n`,
    "nested/re-export.mts": `// import("./not-loaded.mts")\nimport "./../shared.mts";\nexport const value = 7;\n`,
    "query.mts": "export type Query = string;\n",
  };
  await fixture(files, async (root) => {
    const actual = await captureWindowsModuleClosure(root, "entry.mts");
    assert.deepEqual(actual, [
      {
        path: "entry.mts",
        sha256: hash(files["entry.mts"]),
        imports: [
          "nested/re-export.mts",
          "node:crypto",
          "query.mts",
          "shared.mts",
        ],
      },
      {
        path: "nested/re-export.mts",
        sha256: hash(files["nested/re-export.mts"]),
        imports: ["shared.mts"],
      },
      {
        path: "query.mts",
        sha256: hash(files["query.mts"]),
        imports: [],
      },
      {
        path: "shared.mts",
        sha256: hash(files["shared.mts"]),
        imports: ["nested/re-export.mts"],
      },
    ]);
  });
});

test("ignores commented imports and dynamic imports but captures real side-effect imports", async () => {
  const files = {
    "entry.mts": `/* import "./absent.mts";\nimport("./absent.mts"); */\n// import("./absent.mts")\nimport\n  "./real.mts";\n`,
    "real.mts": `export {};\n`,
  };
  await fixture(files, async (root) => {
    assert.deepEqual(
      (await captureWindowsModuleClosure(root, "entry.mts")).map(
        (file) => file.path,
      ),
      ["entry.mts", "real.mts"],
    );
  });
});
test("recognizes comments between import tokens and rejects commented multiline dynamic imports", async () => {
  await fixture(
    {
      "entry.mts": `import /* static import comment */ "./helper.mts";\n`,
      "helper.mts": `export {};\n`,
    },
    async (root) => {
      assert.deepEqual(
        (await captureWindowsModuleClosure(root, "entry.mts")).map(
          (file) => file.path,
        ),
        ["entry.mts", "helper.mts"],
      );
    },
  );
  for (const source of [
    `import /* dynamic import comment */ ("./helper.mts");`,
    `import\n  /* dynamic import comment */\n  (\n    "./helper.mts"\n  );`,
  ]) {
    await fixture(
      { "entry.mts": source, "helper.mts": "export {};\n" },
      async (root) => {
        await assert.rejects(captureWindowsModuleClosure(root, "entry.mts"));
      },
    );
  }
});

test("refreshes hashes when fixture bytes change", async () => {
  await fixture({ "entry.mts": "export const value = 1;\n" }, async (root) => {
    const before = await captureWindowsModuleClosure(root, "entry.mts");
    await writeFile(resolve(root, "entry.mts"), "export const value = 2;\n");
    const after = await captureWindowsModuleClosure(root, "entry.mts");
    assert.deepEqual(before, [
      {
        path: "entry.mts",
        sha256: hash("export const value = 1;\n"),
        imports: [],
      },
    ]);
    assert.deepEqual(after, [
      {
        path: "entry.mts",
        sha256: hash("export const value = 2;\n"),
        imports: [],
      },
    ]);
  });
});

test("rejects dynamic, computed, CommonJS, import-equals and loader mechanisms", async () => {
  for (const source of [
    `import("./dep.mts");`,
    `import(name);`,
    `require("./dep.mts");`,
    `import dep = require("./dep.mts");`,
    `import { createRequire } from "node:module"; createRequire(import.meta.url);`,
    `import * as vm from "node:vm"; vm.runInThisContext("0");`,
    `process.getBuiltinModule("module");`,
    `import.meta.resolve("./dep.mts");`,
    `import.meta["resolve"]("./dep.mts");`,
    `module["register"]("loader");`,
    `new globalThis["Function"]("return import('./dep.mts')")();`,
    `import { Worker } from "node:worker_threads"; new Worker("./dep.mts");`,
    `process.dlopen(module, "./dep.node");`,
    `export * from "node:vm";`,
    `export * as loader from "node:module";`,
    `module._compile("0", "untracked.mts");`,
  ]) {
    await fixture(
      { "entry.mts": source, "dep.mts": "export {};\n" },
      async (root) => {
        await assert.rejects(captureWindowsModuleClosure(root, "entry.mts"));
      },
    );
  }
});
test("requires an absolute root and rejects unsafe module path components", async () => {
  await assert.rejects(captureWindowsModuleClosure(".", "entry.mts"));
  for (const specifier of [
    "./CON.mts",
    "./foo./dep.mts",
    "./..not-a-relative-path.mts",
  ]) {
    await fixture({ "entry.mts": `import "${specifier}";\n` }, async (root) => {
      await assert.rejects(captureWindowsModuleClosure(root, "entry.mts"));
    });
  }
});

test("rejects unsupported attributes, extensions, packages, unresolved dependencies and path escapes", async () => {
  for (const [source, files] of [
    [
      `import data from "./dep.mts" with { type: "json" };`,
      { "dep.mts": "export default {};" },
    ],
    [
      `import data from "./dep.mts" with {};`,
      { "dep.mts": "export default {};" },
    ],
    [`import "./dep.ts";`, { "dep.ts": "export {};" }],
    [`import "pkg";`, {}],
    [`import "./missing.mts";`, {}],
    [`import "../outside.mts";`, {}],
    [`import "./dep.mts?raw";`, { "dep.mts": "export {};" }],
    [
      `import "./encoded%20helper.mts";`,
      {
        "encoded%20helper.mts": "export {};",
        "encoded helper.mts": "export {};",
      },
    ],
    [`const name = "./dep.mts"; import(name);`, { "dep.mts": "export {};" }],
    [`import "./dep.mts"`, { "dep.mts": `export {` }],
  ] as const) {
    await fixture({ "entry.mts": source, ...files }, async (root) => {
      await assert.rejects(captureWindowsModuleClosure(root, "entry.mts"));
    });
  }
});

test("rejects directory modules and junctioned deployment ancestors", async () => {
  await fixture({ "entry.mts": 'import "./directory.mts";' }, async (root) => {
    await mkdir(resolve(root, "directory.mts"));
    await assert.rejects(captureWindowsModuleClosure(root, "entry.mts"));
  });
  await fixture({ "real/entry.mts": "export {};" }, async (root) => {
    const { symlink } = await import("node:fs/promises");
    await symlink(resolve(root, "real"), resolve(root, "alias"), "junction");
    await assert.rejects(
      captureWindowsModuleClosure(resolve(root, "alias"), "entry.mts"),
    );
  });
});

test("rejects the exact reviewed bound builtin loader alias before closure admission", async () => {
  await fixture(
    {
      "entry.mts": `const builtin = process.getBuiltinModule.bind(process);
const { register: loadHooks } = builtin("module");
loadHooks("./untracked-loader.mjs", import.meta.url);`,
      "untracked-loader.mjs":
        "export function resolve() { throw new Error('must not load'); }",
    },
    async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /LOADER_REFERENCE_REJECTED/,
      );
    },
  );
});

test("rejects loader references before binding assignment passing or destructuring can alias them", async () => {
  for (const source of [
    `const cap = process.getBuiltinModule;`,
    `const cap = process.getBuiltinModule.bind(process);`,
    `const cap = process.getBuiltinModule.call;`,
    `const cap = process.getBuiltinModule.apply;`,
    `let cap; cap = process.getBuiltinModule;`,
    `function supply() { return process.getBuiltinModule; } const cap = supply();`,
    `consume(process.getBuiltinModule);`,
    `const { getBuiltinModule: cap } = process;`,
    `const key = "getBuiltinModule"; const { [key]: cap } = process;`,
    `const p = process; const cap = p["get" + "BuiltinModule"];`,
    `const wrap = { process }; const cap = wrap.process.getBuiltinModule;`,
    `declare const process: unknown; const p = process;`,
    `type process = unknown; const p = process;`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /(?:LOADER|AMBIENT_CAPABILITY)_REFERENCE_REJECTED/,
      );
    });
  }
});

test("rejects Node module capability imports global module aliases and require extraction", async () => {
  for (const source of [
    `import { register as cap } from "node:module";`,
    `import { registerHooks as cap } from "node:module";`,
    `import { "register" as cap } from "node:module";`,
    `import { createRequire as cap } from "node:module";`,
    `import { Module as cap } from "node:module";`,
    `import * as cap from "node:module";`,
    `import cap from "node:module";`,
    `import { getBuiltinModule as cap } from "node:process";`,
    `const cap = module.register;`,
    `const cap = Module.registerHooks;`,
    `const { register: cap } = module;`,
    `const { registerHooks: cap } = Module;`,
    `function forward(value) { return value; } const cap = forward(module).register;`,
    `const cap = require.bind(null);`,
    `const cap = createRequire;`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /(?:LOADER|AMBIENT_CAPABILITY)/,
      );
    });
  }
});

test("rejects computed optional parenthesized and reflective loader capability references", async () => {
  for (const source of [
    `const cap = process["getBuiltinModule"];`,
    "const cap = process[`getBuiltinModule`];",
    `const key = "getBuiltinModule"; const cap = process[key];`,
    `const cap = process["get" + "BuiltinModule"];`,
    `const cap = (process.getBuiltinModule);`,
    `const cap = (process)?.getBuiltinModule;`,
    `const cap = (process.getBuiltinModule)?.bind(process);`,
    `const cap = (process as unknown as {getBuiltinModule: unknown}).getBuiltinModule;`,
    `const cap = Reflect.get(process, "getBuiltinModule");`,
    `const { get: read } = Reflect; const cap = read(process, "getBuiltinModule");`,
    `const read = Object.getOwnPropertyDescriptor; const cap = read(process, "getBuiltinModule");`,
    `const key = "getOwnPropertyDescriptor"; const read = Object[key];`,
    `const p = globalThis["process"];`,
    `const p = global.process;`,
    `const cap = (() => {}).constructor;`,
    `const cap = ({})["constructor"];`,
    `const cap = import.meta.resolve;`,
    `const meta = import.meta; const cap = meta.resolve;`,
    `const cap = (import.meta)["resolve"];`,
    `const {resolve: cap} = import.meta;`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /(?:LOADER|AMBIENT_CAPABILITY)_REFERENCE_REJECTED/,
      );
    });
  }
});

test("retains unrelated register names safe module data imports and locally bound process values", async () => {
  const files = {
    "entry.mts": `import { register, registerHooks } from "./safe.mts";
import { builtinModules as names, isBuiltin as check } from "node:module";
const registry = { register, registerHooks };
const bound = registry.register.bind(registry); bound();
const {register: extracted} = registry; extracted();
class Module { static register() { return 3; } } Module.register();
function read(process: {status: string}) { return process.status; }
const process = { register() { return 4; } }; process.register();
export const result = [register(), registerHooks(), read({status:"ok"}), names, check("node:fs")];`,
    "safe.mts":
      "export function register() { return 1; } export function registerHooks() { return 2; }",
  };
  await fixture(files, async (root) => {
    assert.deepEqual(await captureWindowsModuleClosure(root, "entry.mts"), [
      {
        path: "entry.mts",
        sha256: hash(files["entry.mts"]),
        imports: ["node:module", "safe.mts"],
      },
      { path: "safe.mts", sha256: hash(files["safe.mts"]), imports: [] },
    ]);
  });
});

test("rejects the exact reviewed computed constructor before its alias can compile a loader", async () => {
  await fixture(
    {
      "entry.mts": `const compile = (() => {})["con" + "structor"];
compile('process.getBuiltinModule("module").register("file:///D:/review/untracked-loader.mjs")')();`,
    },
    async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /LOADER_REFERENCE_REJECTED/,
      );
    },
  );
});

test("refuses every nonliteral computed key without folding or trusting its apparent value", async () => {
  for (const source of [
    `const key = "constructor"; const compile = (() => {})[key];`,
    `const compile = (() => {})[["con", "structor"].join("")];`,
    `const compile = (() => {})[String("constructor")];`,
    `const compile = (() => {})[("con" + "structor")];`,
    'const compile = (() => {})[`con${"structor"}`];',
    `const compile = (() => {})[({toString() {return "constructor";}})];`,
    `const compile = ((() => {}))?.["con" + "structor"];`,
    `const compile = ({fn: () => {}})["fn"]["con" + "structor"];`,
    `const compile = ((() => {})["bind"])["con" + "structor"];`,
    `const key = "safe"; const data = {safe: 1}; const value = data[key];`,
    `const data = {safe: 1}; const value = data[("safe")];`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /LOADER_REFERENCE_REJECTED/,
      );
    });
  }
});

test("refuses computed property definitions and shorthand or computed constructor extraction", async () => {
  for (const source of [
    `const {constructor: compile} = (() => {});`,
    `const {constructor} = (() => {});`,
    `const {["con" + "structor"]: compile} = (() => {});`,
    `const key = "constructor"; const {[key]: compile} = (() => {});`,
    'const {[`con${"structor"}`]: compile} = (() => {});',
    `const {["constructor"]: compile} = (() => {});`,
    `const key = "safe"; const data = {[key]: 1};`,
    `class Data { ["con" + "structor"]() {} }`,
    `let compile; ({constructor: compile} = (() => {})); compile("return 1")();`,
    `let constructor; ({constructor} = (() => {}));`,
    `let compile; ({["con" + "structor"]: compile} = (() => {}));`,
    `let compile; ({outer: {constructor: compile}} = {outer: () => {}});`,
    `let compile; ([{constructor: compile}] = [() => {}]);`,
    `let compile; for ({constructor: compile} of [() => {}]) { compile("return 1")(); }`,
    `let constructor; for ({constructor} in {}) {}`,
    `let value; ({value} = {value: 7});`,
    `let value; [value] = [7];`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /LOADER_REFERENCE_REJECTED/,
      );
    });
  }
});

test("refuses analogous executable constructor and prototype capability extractions", async () => {
  for (const source of [
    `const compile = (async () => {})["con" + "structor"]; compile("return 1");`,
    `const compile = (function* () {})["constructor"];`,
    `const compile = (async function* () {})[\`constructor\`];`,
    `const compile = ((() => {}) as unknown as Record<string, unknown>)["con" + "structor"];`,
    `const key = "constructor"; let compile; compile = (() => {})[key]; compile("return 1")();`,
    `const {prototype} = (() => {});`,
    `const cap = ({})["__lookupSetter__"];`,
    `const cap = ({})["__defineSetter__"];`,
    `const {__lookupGetter__} = ({});`,
    `const {__defineGetter__: cap} = ({});`,
  ]) {
    await fixture({ "entry.mts": source }, async (root) => {
      await assert.rejects(
        captureWindowsModuleClosure(root, "entry.mts"),
        /LOADER_REFERENCE_REJECTED/,
      );
    });
  }
});

test("captures the complete static graph while permitting literal data indexes and ordinary register aliases", async () => {
  const files = {
    "entry.mts": `import { data } from "./safe.mts";
export { data } from "./safe.mts";
const first = [7][0];
const value = (data)?.["value"];
const template = data[\`value\`];
const {["value"]: extracted} = data;
const record = {["literal"]: first, [1]: template};
const ordinary = {register() {return extracted;}};
const register = ordinary["register"]; register();
export {value, record};`,
    "safe.mts": "export const data = {value: 7};\n",
  };
  await fixture(files, async (root) => {
    assert.deepEqual(await captureWindowsModuleClosure(root, "entry.mts"), [
      {
        path: "entry.mts",
        sha256: hash(files["entry.mts"]),
        imports: ["safe.mts"],
      },
      { path: "safe.mts", sha256: hash(files["safe.mts"]), imports: [] },
    ]);
  });
});

test("admits only the exact immutable reviewed data-index snapshots and refuses renamed or edited copies", async () => {
  const moduleNames = [
    "migration-contract.mts",
    "source-contract.mts",
    "windows-command-dispatch.mts",
    "windows-launch.mts",
    "windows-lease-journal.mts",
    "windows-resource-invocation.mts",
    "windows-resources.mts",
    "windows-source.mts",
    "windows-docker-cli.mts",
  ];
  const files: Record<string, string> = {};
  for (const name of moduleNames)
    files[name] = await readFile(new URL(name, import.meta.url), "utf8");
  await fixture(files, async (root) => {
    // Establish admission before exercising the rename and byte-drift transitions.
    await captureWindowsModuleClosure(root, "windows-resource-invocation.mts");
    const original = files["windows-source.mts"];
    assert.ok(original);
    await writeFile(resolve(root, "renamed.mts"), original);
    await assert.rejects(
      captureWindowsModuleClosure(root, "renamed.mts"),
      /LOADER_REFERENCE_REJECTED/,
    );
    await writeFile(
      resolve(root, "windows-source.mts"),
      original + "\n// edited\n",
    );
    await assert.rejects(
      captureWindowsModuleClosure(root, "windows-resource-invocation.mts"),
      /LOADER_REFERENCE_REJECTED/,
    );
  });
});
