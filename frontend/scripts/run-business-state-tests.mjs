import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function toWindowsSafePath(value) {
  return process.platform === "win32" && value.startsWith("/")
    ? value.slice(1)
    : value;
}

function resolveModule(specifier, fromFile) {
  if (specifier.startsWith("@/")) {
    return resolveFile(path.join(projectRoot, specifier.slice(2)));
  }
  if (specifier.startsWith(".")) {
    return resolveFile(path.resolve(path.dirname(fromFile), specifier));
  }
  return specifier;
}

function resolveFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!match) {
    throw new Error(`Cannot resolve module file: ${basePath}`);
  }
  return match;
}

function loadLocalModule(filename) {
  const normalized = path.normalize(filename);
  if (moduleCache.has(normalized)) return moduleCache.get(normalized).exports;

  const source = fs.readFileSync(normalized, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: normalized,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(normalized, module);

  const localRequire = (specifier) => {
    const resolved = resolveModule(specifier, normalized);
    if (typeof resolved === "string" && path.isAbsolute(resolved)) {
      return loadLocalModule(resolved);
    }
    return nodeRequire(specifier);
  };

  const wrapper = `(function (exports, require, module, __filename, __dirname) {\n${transpiled}\n})`;
  const compiled = vm.runInThisContext(wrapper, { filename: normalized });
  compiled(module.exports, localRequire, module, normalized, path.dirname(normalized));
  return module.exports;
}

function collectTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTests(fullPath);
    return /\.test\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

const testsRoot = path.join(projectRoot, "components", "dashboard", "scan-terminal", "__tests__");
const testFiles = fs.existsSync(testsRoot) ? collectTests(testsRoot).sort() : [];

if (!testFiles.length) {
  throw new Error(`No business state tests found under ${testsRoot}`);
}

let passed = 0;
for (const file of testFiles) {
  const exported = loadLocalModule(toWindowsSafePath(file));
  const run = exported.runTests || exported.default;
  if (typeof run !== "function") {
    throw new Error(`${file} must export runTests()`);
  }
  await run();
  passed += 1;
  console.log(`✓ ${path.relative(projectRoot, file)}`);
}

console.log(`Business state tests passed: ${passed}/${testFiles.length}`);
