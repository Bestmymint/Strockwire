import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { BootstrapClosureFile } from "./windows-launch.mts";

const builtins = new Set(
  builtinModules.map((name) =>
    name.startsWith("node:") ? name : `node:${name}`,
  ),
);
const MAX_SOURCE_BYTES = 1024 * 1024;
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

// Frozen R2/F2 data-index sites, not a general computed-access permission.
// Path, complete raw bytes and expression must all match; edits need re-review.
// Never populate this table from candidate files, configuration or approval data.
// Image-binding compatibility refreshes only resource bytes; all 22 original sites are unchanged.
// These candidate compatibility pins require independent R2/F1 re-review, not deployment approval.
const REVIEWED_DATA_INDEXES = new Map<string, ReadonlySet<string>>([
  [
    "migration-contract.mts:950429a8cad82d72f90054d5de6695e40ad69e00c9dbfbb1ced81058585cf044",
    new Set([
      "execution.migrations[index]",
      "ledger[index]",
      "execution[index]",
    ]),
  ],
  [
    "source-contract.mts:ef0b63e49a86c56d27e08d4c935d0ddefad588669b0b431801f94268b7bb7384",
    new Set(["expected[index - 1]"]),
  ],
  [
    "windows-lease-journal.mts:e0a8336d9babef8a1f2b509763d4f099fee78170e03b017f056be0fc0d46a240",
    new Set(["object(value)[key]", "fields[key]", "this.identity[key]"]),
  ],
  [
    "windows-resource-invocation.mts:49d02c96c315e39a8eccb6a5657d460127073ff5bb99c33116d9acdaf7026996",
    new Set(["object[key]"]),
  ],
  [
    "windows-resources.mts:5df762420bd4ac9254cca4d250c3270d62fed34251182eabfc3da9571f53bd7e",
    new Set([
      "record(value)[key]",
      "environment[key]",
      "labels[OWNER]",
      "labels[TOKEN]",
      "labels[ROLE]",
      "inventory[kind]",
      "networks[this.state.networkName]",
    ]),
  ],
  [
    "windows-source.mts:2932219e3f0c5da265546161b7b2975fe2507448bea5ed2561b49803d8d4930a",
    new Set(["safe[canonical]", "approved[i - 1]"]),
  ],
]);

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++)
    if (value.charCodeAt(index) < 32 || value.charCodeAt(index) === 127)
      return true;
  return false;
}

function fail(reason: string): never {
  throw new Error(`WINDOWS_MODULE_CLOSURE_${reason}`);
}
function stableFile(filePath: string, root: string): string {
  const rel = relative(root, filePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    fail("PATH_ESCAPES_ROOT");
  return rel.split(sep).join("/");
}

async function checkedPath(
  root: string,
  relativePath: string,
): Promise<string> {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    /[?#\0]/.test(relativePath)
  )
    fail("UNSUPPORTED_PATH");
  const parts = relativePath.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/.test(part) ||
        hasAsciiControl(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    fail("UNSUPPORTED_PATH");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) fail("UNSUPPORTED_PATH");
    const parent = await lstat(current);
    if (parent.isSymbolicLink() || !parent.isDirectory())
      fail("UNSAFE_DIRECTORY");
    const entries = await readdir(current);
    const folded = part.toLowerCase();
    const matches = entries.filter((entry) => entry.toLowerCase() === folded);
    if (matches.length !== 1 || matches[0] !== part)
      fail("AMBIGUOUS_OR_MISSING_PATH");
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail("SYMLINK_REJECTED");
    if (i < parts.length - 1 && !info.isDirectory()) fail("UNSAFE_DIRECTORY");
    if (i === parts.length - 1 && !info.isFile()) fail("NON_REGULAR_FILE");
  }
  return current;
}

function moduleSpecifiers(
  sourceFile: ts.SourceFile,
  modulePath: string,
  sourceSha256: string,
): string[] {
  const reviewedDataIndexes = REVIEWED_DATA_INDEXES.get(
    `${modulePath}:${sourceSha256}`,
  );
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (
    fileName,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    resolve(fileName) === resolve(sourceFile.fileName)
      ? sourceFile
      : getSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram([sourceFile.fileName], options, host);
  if (
    program.getSyntacticDiagnostics(sourceFile).length ||
    sourceFile.referencedFiles.length ||
    sourceFile.typeReferenceDirectives.length ||
    sourceFile.amdDependencies.length
  )
    fail("PARSE_UNCERTAIN");
  const checker = program.getTypeChecker();
  // Capabilities are denied at acquisition, before aliases can hide their origin.
  // This is a bounded static-loading policy, not general JavaScript data-flow analysis.
  const forbiddenMembers = new Set([
    "getBuiltinModule",
    "createRequire",
    "require",
    "eval",
    "Function",
    "runInThisContext",
    "runInNewContext",
    "compileFunction",
    "createContext",
    "dlopen",
    "binding",
    "_linkedBinding",
    "_load",
    "_compile",
    "constructor",
    "prototype",
    "__proto__",
    "__defineGetter__",
    "__lookupGetter__",
    "__defineSetter__",
    "__lookupSetter__",
  ]);
  const processMembers = new Set([
    "env",
    "argv",
    "execArgv",
    "execPath",
    "platform",
    "pid",
    "cwd",
    "exitCode",
  ]);
  const objectMembers = new Set([
    "keys",
    "values",
    "entries",
    "assign",
    "freeze",
    "hasOwn",
    "is",
    "create",
  ]);
  const moduleDataExports = new Set(["builtinModules", "isBuiltin"]);
  const ambientRoots = new Set([
    "process",
    "Object",
    "Reflect",
    "globalThis",
    "global",
    "module",
    "Module",
  ]);
  const metadataMembers = new Set(["url", "filename", "dirname", "main"]);
  const directMember = (node: ts.Node): ts.PropertyAccessExpression | null => {
    let receiver = node;
    while (
      (ts.isParenthesizedExpression(receiver.parent) ||
        ts.isAsExpression(receiver.parent) ||
        ts.isTypeAssertionExpression(receiver.parent) ||
        ts.isNonNullExpression(receiver.parent) ||
        ts.isSatisfiesExpression(receiver.parent)) &&
      receiver.parent.expression === receiver
    )
      receiver = receiver.parent;
    const parent = receiver.parent;
    return ts.isPropertyAccessExpression(parent) &&
      parent.expression === receiver
      ? parent
      : null;
  };
  const checkComputedMember = (key: ts.Expression, access: ts.Node): void => {
    if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
      if (forbiddenMembers.has(key.text)) fail("LOADER_REFERENCE_REJECTED");
      return;
    }
    if (ts.isNumericLiteral(key)) return;
    // No folding, coercion or inferred safety for aliases/templates/expressions.
    if (!reviewedDataIndexes?.has(access.getText(sourceFile)))
      fail("LOADER_REFERENCE_REJECTED");
  };
  const checkAssignmentTarget = (target: ts.Node): void => {
    while (
      ts.isParenthesizedExpression(target) ||
      ts.isAsExpression(target) ||
      ts.isTypeAssertionExpression(target) ||
      ts.isNonNullExpression(target) ||
      ts.isSatisfiesExpression(target)
    )
      target = target.expression;
    // Assignment patterns have different AST nodes from declaration bindings.
    // They are unsupported, rather than inferring safety through extracted values.
    if (
      ts.isObjectLiteralExpression(target) ||
      ts.isArrayLiteralExpression(target)
    )
      fail("LOADER_REFERENCE_REJECTED");
  };
  const checkReferences = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      checkAssignmentTarget(node.left);
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    )
      checkAssignmentTarget(node.initializer);
    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      const member = directMember(node);
      if (!member || !metadataMembers.has(member.name.text))
        fail("LOADER_REFERENCE_REJECTED");
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (forbiddenMembers.has(node.name.text))
        fail("LOADER_REFERENCE_REJECTED");
    }
    if (ts.isElementAccessExpression(node))
      checkComputedMember(node.argumentExpression, node);
    if (ts.isComputedPropertyName(node))
      checkComputedMember(node.expression, node);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (
        (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
        forbiddenMembers.has(key.text)
      )
        fail("LOADER_REFERENCE_REJECTED");
    }
    if (!ts.isIdentifier(node) || !ambientRoots.has(node.text)) return;
    // Property keys are data; shorthand values still reference the ambient binding.
    if (
      (ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node) ||
      (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    )
      return;
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (
      symbol &&
      symbol.flags & ts.SymbolFlags.Value &&
      symbol.declarations?.some(
        (declaration) =>
          declaration.getSourceFile() === sourceFile &&
          !(
            ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient
          ),
      )
    )
      return;
    const member = directMember(node);
    const allowed =
      node.text === "process"
        ? processMembers
        : node.text === "Object"
          ? objectMembers
          : null;
    if (!allowed || !member || !allowed.has(member.name.text))
      fail("AMBIENT_CAPABILITY_REFERENCE_REJECTED");
  };
  const found: string[] = [];
  const add = (expression: ts.Expression | undefined) => {
    if (!expression || !ts.isStringLiteral(expression))
      fail("NON_LITERAL_IMPORT");
    const specifier = expression.text;
    if (/[?#%\\\0]/.test(specifier)) fail("UNSUPPORTED_SPECIFIER");
    if (builtins.has(specifier)) {
      if (
        [
          "node:vm",
          "node:worker_threads",
          "node:wasi",
          "node:inspector",
          "node:repl",
          "node:process",
        ].includes(specifier)
      )
        fail("LOADER_MODULE_REJECTED");
      found.push(specifier);
      return;
    }
    if (specifier.startsWith("node:")) fail("UNSUPPORTED_BUILTIN");
    if (!specifier.startsWith("./") && !specifier.startsWith("../"))
      fail("PACKAGE_IMPORT_REJECTED");
    if (!specifier.endsWith(".mts")) fail("UNSUPPORTED_EXTENSION");
    found.push(specifier);
  };
  const visit = (node: ts.Node): void => {
    checkReferences(node);
    if (ts.isImportDeclaration(node)) {
      if (node.attributes) fail("IMPORT_ATTRIBUTES_UNSUPPORTED");
      const bindings = node.importClause?.namedBindings;
      if (
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "node:module" &&
        (!bindings ||
          !ts.isNamedImports(bindings) ||
          node.importClause?.name ||
          bindings.elements.some(
            (element) =>
              !moduleDataExports.has(
                element.propertyName?.text ?? element.name.text,
              ),
          ))
      )
        fail("LOADER_MODULE_REJECTED");
      add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (node.attributes) fail("IMPORT_ATTRIBUTES_UNSUPPORTED");
      if (
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "node:module"
      )
        fail("LOADER_MODULE_REJECTED");
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      fail("IMPORT_EQUALS_REJECTED");
    } else if (ts.isImportTypeNode(node)) {
      if (node.attributes || node.assertions)
        fail("IMPORT_ATTRIBUTES_UNSUPPORTED");
      if (
        !ts.isLiteralTypeNode(node.argument) ||
        !ts.isStringLiteral(node.argument.literal)
      )
        fail("NON_LITERAL_IMPORT");
      add(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      // Workers, native addons and computed constructors are outside this static module contract.
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        fail("DYNAMIC_IMPORT_REJECTED");
      if (ts.isElementAccessExpression(node.expression))
        fail("LOADER_CALL_REJECTED");
      // Other restricted calls are rejected at their capability-reference nodes.
    } else if (
      ts.isNewExpression(node) &&
      ts.isElementAccessExpression(node.expression)
    ) {
      fail("LOADER_CALL_REJECTED");
    } else if (
      ts.isIdentifier(node) &&
      ["require", "createRequire", "eval", "Function"].includes(node.text)
    ) {
      fail("LOADER_REFERENCE_REJECTED");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(found)].sort();
}

/** Capture the exact, recursively imported .mts closure using TypeScript syntax and filesystem bytes. */
export async function captureWindowsModuleClosure(
  root: string,
  entryModule: string,
): Promise<BootstrapClosureFile[]> {
  if (!isAbsolute(root)) fail("UNSAFE_ROOT");
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail("UNSAFE_ROOT");
  const absoluteRoot = resolve(root);
  let ancestor = parse(absoluteRoot).root;
  for (const part of relative(ancestor, absoluteRoot)
    .split(sep)
    .filter(Boolean)) {
    ancestor = resolve(ancestor, part);
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("UNSAFE_ROOT");
  }
  if (
    entryModule.includes("\\") ||
    entryModule.startsWith("/") ||
    entryModule
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    fail("UNSUPPORTED_ENTRY");
  if (!entryModule.endsWith(".mts")) fail("UNSUPPORTED_EXTENSION");
  const files = new Map<string, BootstrapClosureFile>();
  const visiting = new Set<string>();
  const visit = async (relativePath: string): Promise<void> => {
    const path = await checkedPath(absoluteRoot, relativePath);
    const key = stableFile(path, absoluteRoot);
    if (files.has(key) || visiting.has(key)) return;
    visiting.add(key);
    const before = await lstat(path);
    if (before.size > MAX_SOURCE_BYTES) fail("FILE_TOO_LARGE");
    const bytes = await readFile(path);
    const after = await lstat(path);
    if (
      !after.isFile() ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      bytes.length !== before.size
    )
      fail("FILE_CHANGED_DURING_CAPTURE");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("INVALID_UTF8");
    }
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const sourceSha256 = digest(bytes);
    const imports = moduleSpecifiers(source, key, sourceSha256);
    const resolvedImports: string[] = [];
    for (const specifier of imports) {
      if (builtins.has(specifier)) resolvedImports.push(specifier);
      else {
        const target = resolve(dirname(path), specifier);
        const targetRel = stableFile(target, absoluteRoot);
        if (!targetRel.endsWith(".mts")) fail("UNSUPPORTED_EXTENSION");
        resolvedImports.push(targetRel);
        await visit(targetRel);
      }
    }
    files.set(key, {
      path: key,
      sha256: sourceSha256,
      imports: resolvedImports.sort(),
    });
    visiting.delete(key);
  };
  await visit(entryModule);
  return [...files.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
