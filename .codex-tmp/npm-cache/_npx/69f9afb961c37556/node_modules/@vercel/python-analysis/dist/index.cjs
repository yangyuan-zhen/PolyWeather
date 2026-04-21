var __import_meta_url__ = require("url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  DependencySourceSchema: () => DependencySourceSchema,
  HashDigestSchema: () => HashDigestSchema,
  LicenseObjectSchema: () => LicenseObjectSchema,
  LicenseSchema: () => LicenseSchema,
  NormalizedRequirementSchema: () => NormalizedRequirementSchema,
  PersonSchema: () => PersonSchema,
  PipfileDependencyDetailSchema: () => PipfileDependencyDetailSchema,
  PipfileDependencySchema: () => PipfileDependencySchema,
  PipfileLikeSchema: () => PipfileLikeSchema,
  PipfileLockLikeSchema: () => PipfileLockLikeSchema,
  PipfileLockMetaSchema: () => PipfileLockMetaSchema,
  PipfileSourceSchema: () => PipfileSourceSchema,
  PyProjectBuildSystemSchema: () => PyProjectBuildSystemSchema,
  PyProjectDependencyGroupsSchema: () => PyProjectDependencyGroupsSchema,
  PyProjectProjectSchema: () => PyProjectProjectSchema,
  PyProjectTomlSchema: () => PyProjectTomlSchema,
  PyProjectToolSectionSchema: () => PyProjectToolSectionSchema,
  PythonAnalysisError: () => PythonAnalysisError,
  PythonBuild: () => PythonBuild,
  PythonConfigKind: () => PythonConfigKind,
  PythonImplementation: () => PythonImplementation,
  PythonLockFileKind: () => PythonLockFileKind,
  PythonManifestConvertedKind: () => PythonManifestConvertedKind,
  PythonManifestKind: () => PythonManifestKind,
  PythonVariant: () => PythonVariant,
  PythonVersion: () => PythonVersion,
  ReadmeObjectSchema: () => ReadmeObjectSchema,
  ReadmeSchema: () => ReadmeSchema,
  UvConfigSchema: () => UvConfigSchema,
  UvConfigWorkspaceSchema: () => UvConfigWorkspaceSchema,
  UvIndexEntrySchema: () => UvIndexEntrySchema,
  classifyPackages: () => classifyPackages,
  containsTopLevelCallable: () => containsTopLevelCallable,
  createMinimalManifest: () => createMinimalManifest,
  discoverPythonPackage: () => discoverPythonPackage,
  evaluateMarker: () => evaluateMarker,
  extendDistRecord: () => extendDistRecord,
  findAppOrHandler: () => findAppOrHandler,
  getStringConstant: () => getStringConstant,
  isPrivatePackageSource: () => isPrivatePackageSource,
  isWheelCompatible: () => isWheelCompatible,
  normalizePackageName: () => normalizePackageName2,
  parsePep508: () => parsePep508,
  parseUvLock: () => parseUvLock,
  scanDistributions: () => scanDistributions,
  selectPython: () => selectPython,
  selectPythonVersion: () => selectPythonVersion,
  stringifyManifest: () => stringifyManifest
});
module.exports = __toCommonJS(src_exports);

// src/wasm/load.ts
var import_promises = require("fs/promises");
var import_node_module = require("module");
var import_node_path = require("path");

// src/wasm/host-utils.ts
var import_node_async_hooks = require("async_hooks");
var import_posix = require("path/posix");
var import_url = require("url");
var readFileStorage = new import_node_async_hooks.AsyncLocalStorage();
var WitResultError = class extends Error {
  constructor(message) {
    super(message);
    this.payload = message;
  }
};
function createHostUtils() {
  return {
    readFile(path4) {
      const ctx = readFileStorage.getStore();
      if (ctx?.readFile) {
        const relative2 = stripWorkingDir(path4, ctx.workingDir);
        if (relative2 != null) {
          const result = ctx.readFile(relative2);
          if (result != null)
            return result;
        }
      }
      throw new WitResultError(`File not found: ${path4}`);
    },
    domainToAscii(domain) {
      try {
        if (/[:#?/@[\]%\\\t\n\r]/.test(domain)) {
          throw new Error("domain contains invalid characters");
        }
        const url = new URL(`http://${domain}/`);
        if (url.hostname === "" && domain !== "") {
          throw new Error("domain resolved to empty hostname");
        }
        return url.hostname;
      } catch {
        throw { payload: `Invalid domain: ${domain}` };
      }
    },
    domainToUnicode(domain) {
      const result = (0, import_url.domainToUnicode)(domain);
      if (result !== "" || domain === "") {
        return [result, true];
      }
      return [domain, false];
    },
    nfcNormalize(s) {
      return s.normalize("NFC");
    },
    nfdNormalize(s) {
      return s.normalize("NFD");
    },
    nfkcNormalize(s) {
      return s.normalize("NFKC");
    },
    nfkdNormalize(s) {
      return s.normalize("NFKD");
    }
  };
}
function stripWorkingDir(path4, workingDir) {
  const normalized = (0, import_posix.normalize)(path4);
  if (!workingDir) {
    return normalized;
  }
  const normalizedDir = (0, import_posix.normalize)(workingDir);
  const prefix = normalizedDir.endsWith("/") ? normalizedDir : normalizedDir + "/";
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  if (normalized === normalizedDir) {
    return "";
  }
  return null;
}

// src/wasm/load.ts
var WASI_SHIM_PATH = "@bytecodealliance/preview2-shim/instantiation";
var WASM_MODULE_PATH = "#wasm/vercel_python_analysis.js";
var wasmInstance = null;
var wasmLoadPromise = null;
var wasmDir = null;
function getWasmDir() {
  if (wasmDir === null) {
    const require2 = (0, import_node_module.createRequire)(__import_meta_url__);
    const wasmModulePath = require2.resolve(WASM_MODULE_PATH);
    wasmDir = (0, import_node_path.dirname)(wasmModulePath);
  }
  return wasmDir;
}
async function getCoreModule(path4) {
  const wasmPath = (0, import_node_path.join)(getWasmDir(), path4);
  const wasmBytes = new Uint8Array(await (0, import_promises.readFile)(wasmPath));
  return WebAssembly.compile(wasmBytes);
}
async function importWasmModule() {
  if (wasmInstance) {
    return wasmInstance;
  }
  if (!wasmLoadPromise) {
    wasmLoadPromise = (async () => {
      const wasiShimModule = await import(WASI_SHIM_PATH);
      const WASIShim = wasiShimModule.WASIShim;
      const wasmModule = await import(WASM_MODULE_PATH);
      const imports = {
        ...new WASIShim().getImportObject(),
        "vercel:python-analysis/host-utils": createHostUtils()
      };
      const instance = await wasmModule.instantiate(getCoreModule, imports);
      wasmInstance = instance;
      return instance;
    })();
  }
  return wasmLoadPromise;
}

// src/semantic/entrypoints.ts
async function findAppOrHandler(source) {
  if (!source.includes("app") && !source.includes("application") && !source.includes("handler") && !source.includes("Handler")) {
    return null;
  }
  const mod = await importWasmModule();
  return mod.findAppOrHandler(source) ?? null;
}
async function containsTopLevelCallable(source, name) {
  if (!source.includes(name)) {
    return false;
  }
  const mod = await importWasmModule();
  return mod.containsTopLevelCallable(source, name);
}
async function getStringConstant(source, name) {
  const mod = await importWasmModule();
  return mod.getStringConstant(source, name) ?? null;
}

// src/manifest/dist-metadata.ts
var import_node_crypto = require("crypto");
var import_node_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_node_path2 = require("path");

// src/manifest/pep508.ts
var EXTRAS_REGEX = /^(.+)\[([^\]]+)\]$/;
function splitExtras(spec) {
  const match = EXTRAS_REGEX.exec(spec);
  if (!match) {
    return [spec, void 0];
  }
  const extras = match[2].split(",").map((e) => e.trim());
  return [match[1], extras];
}
function normalizePackageName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}
function formatPep508(req) {
  let result = req.name;
  if (req.extras && req.extras.length > 0) {
    result += `[${req.extras.join(",")}]`;
  }
  if (req.url) {
    result += ` @ ${req.url}`;
  } else if (req.version && req.version !== "*") {
    result += req.version;
  }
  if (req.markers) {
    result += ` ; ${req.markers}`;
  }
  return result;
}
function mergeExtras(existing, additional) {
  const result = new Set(existing || []);
  if (additional) {
    const additionalArray = Array.isArray(additional) ? additional : [additional];
    for (const extra of additionalArray) {
      result.add(extra);
    }
  }
  return result.size > 0 ? Array.from(result) : void 0;
}
function wasmEntryToRequirement(entry) {
  const req = {
    name: entry.name || ""
  };
  if (entry.versionSpec) {
    req.version = entry.versionSpec;
  }
  if (entry.extras.length > 0) {
    req.extras = entry.extras;
  }
  if (entry.markers) {
    req.markers = entry.markers;
  }
  if (entry.url) {
    req.url = entry.url;
  }
  return req;
}
async function parsePep508(depOrDeps) {
  const wasm = await importWasmModule();
  if (Array.isArray(depOrDeps)) {
    return depOrDeps.map((dep) => {
      try {
        return wasmEntryToRequirement(wasm.parsePep508(dep));
      } catch {
        return null;
      }
    });
  }
  try {
    return wasmEntryToRequirement(wasm.parsePep508(depOrDeps));
  } catch {
    return null;
  }
}

// src/manifest/dist-metadata.ts
async function readDistInfoFile(distInfoDir, filename) {
  try {
    return await (0, import_promises2.readFile)((0, import_node_path2.join)(distInfoDir, filename), "utf-8");
  } catch {
    return void 0;
  }
}
async function scanDistributions(sitePackagesDir) {
  const mod = await importWasmModule();
  const index = /* @__PURE__ */ new Map();
  let entries;
  try {
    entries = await (0, import_promises2.readdir)(sitePackagesDir);
  } catch {
    return index;
  }
  const distInfoDirs = entries.filter((e) => e.endsWith(".dist-info"));
  for (const dirName of distInfoDirs) {
    const distInfoPath = (0, import_node_path2.join)(sitePackagesDir, dirName);
    const metadataContent = await readDistInfoFile(distInfoPath, "METADATA");
    if (!metadataContent) {
      console.debug(`Missing METADATA in ${dirName}`);
      continue;
    }
    let metadata;
    try {
      metadata = mod.parseDistMetadata(
        new TextEncoder().encode(metadataContent)
      );
    } catch (e) {
      console.debug(`Failed to parse METADATA for ${dirName}: ${e}`);
      continue;
    }
    const normalizedName = mod.normalizePackageName(metadata.name);
    let files = [];
    const recordContent = await readDistInfoFile(distInfoPath, "RECORD");
    if (recordContent) {
      try {
        files = mod.parseRecord(recordContent);
      } catch (e) {
        console.warn(`Failed to parse RECORD for ${dirName}: ${e}`);
      }
    }
    let origin;
    const directUrlContent = await readDistInfoFile(
      distInfoPath,
      "direct_url.json"
    );
    if (directUrlContent) {
      try {
        origin = mod.parseDirectUrl(directUrlContent);
      } catch (e) {
        console.debug(`Failed to parse direct_url.json for ${dirName}: ${e}`);
      }
    }
    const installerContent = await readDistInfoFile(distInfoPath, "INSTALLER");
    const installer = installerContent?.trim() || void 0;
    const dist = {
      name: normalizedName,
      version: metadata.version,
      metadataVersion: metadata.metadataVersion,
      summary: metadata.summary,
      description: metadata.description,
      descriptionContentType: metadata.descriptionContentType,
      requiresDist: metadata.requiresDist,
      requiresPython: metadata.requiresPython,
      providesExtra: metadata.providesExtra,
      author: metadata.author,
      authorEmail: metadata.authorEmail,
      maintainer: metadata.maintainer,
      maintainerEmail: metadata.maintainerEmail,
      license: metadata.license,
      licenseExpression: metadata.licenseExpression,
      classifiers: metadata.classifiers,
      homePage: metadata.homePage,
      projectUrls: metadata.projectUrls,
      platforms: metadata.platforms,
      dynamic: metadata.dynamic,
      files,
      origin,
      installer
    };
    index.set(normalizedName, dist);
  }
  return index;
}
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = (0, import_node_crypto.createHash)("sha256");
    let size = 0;
    const stream = (0, import_node_fs.createReadStream)(filePath);
    stream.on("data", (chunk) => {
      size += chunk.length;
      h.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve({ hash: h.digest("base64url"), size });
    });
  });
}
async function extendDistRecord(sitePackagesDir, packageName, paths) {
  const normalizedTarget = normalizePackageName(packageName);
  const entries = await (0, import_promises2.readdir)(sitePackagesDir);
  const distInfoDirName = entries.find((e) => {
    if (!e.endsWith(".dist-info"))
      return false;
    const withoutSuffix = e.slice(0, -".dist-info".length);
    const lastHyphen = withoutSuffix.lastIndexOf("-");
    if (lastHyphen === -1)
      return false;
    const dirName = withoutSuffix.slice(0, lastHyphen);
    return normalizePackageName(dirName) === normalizedTarget;
  });
  if (!distInfoDirName) {
    throw new Error(
      `No .dist-info directory found for package "${packageName}" in ${sitePackagesDir}`
    );
  }
  const recordPath = (0, import_node_path2.join)(sitePackagesDir, distInfoDirName, "RECORD");
  let existingRecord;
  try {
    existingRecord = await (0, import_promises2.readFile)(recordPath, "utf-8");
  } catch {
    throw new Error(`RECORD file not found in ${distInfoDirName}`);
  }
  const existingPaths = new Set(
    existingRecord.split("\n").filter((line) => line.length > 0).map((line) => line.split(",")[0])
  );
  const newEntries = paths.filter((p) => !existingPaths.has(p));
  if (newEntries.length > 0) {
    const prefix = existingRecord.length > 0 && !existingRecord.endsWith("\n") ? "\n" : "";
    const lines = [];
    for (const p of newEntries) {
      const fullPath = (0, import_node_path2.join)(sitePackagesDir, p);
      const { hash, size } = await hashFile(fullPath);
      lines.push(`${p},sha256=${hash},${size}`);
    }
    await (0, import_promises2.appendFile)(recordPath, prefix + lines.join("\n") + "\n");
  }
  return newEntries.length;
}

// src/manifest/package.ts
var import_node_path5 = __toESM(require("path"), 1);
var import_minimatch = require("minimatch");

// src/util/config.ts
var import_node_path4 = __toESM(require("path"), 1);
var import_js_yaml = __toESM(require("js-yaml"), 1);
var import_smol_toml = __toESM(require("smol-toml"), 1);

// src/util/fs.ts
var import_node_path3 = __toESM(require("path"), 1);
var import_fs_extra = require("fs-extra");

// src/util/error.ts
var import_node_util = __toESM(require("util"), 1);
var isErrnoException = (error, code = void 0) => {
  return import_node_util.default.types.isNativeError(error) && "code" in error && (code === void 0 || error.code === code);
};
var PythonAnalysisError = class extends Error {
  constructor({
    message,
    code,
    path: path4,
    link,
    action,
    fileContent
  }) {
    super(message);
    this.hideStackTrace = true;
    this.name = "PythonAnalysisError";
    this.code = code;
    this.path = path4;
    this.link = link;
    this.action = action;
    this.fileContent = fileContent;
  }
};

// src/util/fs.ts
async function readFileIfExists(file) {
  try {
    return await (0, import_fs_extra.readFile)(file);
  } catch (error) {
    if (!isErrnoException(error, "ENOENT")) {
      throw error;
    }
  }
  return null;
}
async function readFileTextIfExists(file, encoding = "utf8") {
  const data = await readFileIfExists(file);
  if (data == null) {
    return null;
  } else {
    return data.toString(encoding);
  }
}
function normalizePath(p) {
  let np = import_node_path3.default.normalize(p);
  if (np.endsWith(import_node_path3.default.sep)) {
    np = np.slice(0, -1);
  }
  return np;
}
function isSubpath(somePath, parentPath) {
  const rel = import_node_path3.default.relative(parentPath, somePath);
  return rel === "" || !rel.startsWith("..") && !import_node_path3.default.isAbsolute(rel);
}

// src/util/config.ts
function parseRawConfig(content, filename, filetype = void 0) {
  if (filetype === void 0) {
    filetype = import_node_path4.default.extname(filename.toLowerCase());
  }
  try {
    if (filetype === ".json") {
      return JSON.parse(content);
    } else if (filetype === ".toml") {
      return import_smol_toml.default.parse(content);
    } else if (filetype === ".yaml" || filetype === ".yml") {
      return import_js_yaml.default.load(content, { filename });
    } else {
      throw new PythonAnalysisError({
        message: `Could not parse config file "${filename}": unrecognized config format`,
        code: "PYTHON_CONFIG_UNKNOWN_FORMAT",
        path: filename
      });
    }
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new PythonAnalysisError({
        message: `Could not parse config file "${filename}": ${error.message}`,
        code: "PYTHON_CONFIG_PARSE_ERROR",
        path: filename,
        fileContent: content
      });
    }
    throw error;
  }
}
function parseConfig(content, filename, schema, filetype = void 0) {
  const raw = parseRawConfig(content, filename, filetype);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path4 = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path4}: ${issue.message}`;
    }).join("\n");
    throw new PythonAnalysisError({
      message: `Invalid config in "${filename}":
${issues}`,
      code: "PYTHON_CONFIG_VALIDATION_ERROR",
      path: filename,
      fileContent: content
    });
  }
  return result.data;
}
async function readConfigIfExists(filename, schema, filetype = void 0) {
  const content = await readFileTextIfExists(filename);
  if (content == null) {
    return null;
  }
  return parseConfig(content, filename, schema, filetype);
}

// src/manifest/pep440.ts
var import_node_assert = __toESM(require("assert"), 1);
var import_version = require("@renovatebot/pep440/lib/version");
var import_pep440 = require("@renovatebot/pep440");
var import_specifier = require("@renovatebot/pep440/lib/specifier");
function pep440ConstraintFromVersion(v) {
  return [
    {
      operator: "==",
      version: unparsePep440Version(v),
      prefix: ""
    }
  ];
}
function unparsePep440Version(v) {
  const verstr = (0, import_version.stringify)(v);
  (0, import_node_assert.default)(verstr != null, "pep440/lib/version:stringify returned null");
  return verstr;
}

// src/manifest/pipfile/schema.zod.ts
var import_zod = require("zod");
var pipfileDependencyDetailSchema = import_zod.z.object({
  version: import_zod.z.string().optional(),
  hashes: import_zod.z.array(import_zod.z.string()).optional(),
  extras: import_zod.z.union([import_zod.z.array(import_zod.z.string()), import_zod.z.string()]).optional(),
  markers: import_zod.z.string().optional(),
  index: import_zod.z.string().optional(),
  git: import_zod.z.string().optional(),
  ref: import_zod.z.string().optional(),
  editable: import_zod.z.boolean().optional(),
  path: import_zod.z.string().optional()
});
var pipfileDependencySchema = import_zod.z.union([
  import_zod.z.string(),
  pipfileDependencyDetailSchema
]);
var pipfileSourceSchema = import_zod.z.object({
  name: import_zod.z.string(),
  url: import_zod.z.string(),
  verify_ssl: import_zod.z.boolean().optional()
});
var pipfileLikeSchema = import_zod.z.record(
  import_zod.z.union([
    import_zod.z.record(pipfileDependencySchema),
    import_zod.z.array(pipfileSourceSchema),
    import_zod.z.record(import_zod.z.string()),
    import_zod.z.undefined()
  ])
).and(
  import_zod.z.object({
    packages: import_zod.z.record(pipfileDependencySchema).optional(),
    "dev-packages": import_zod.z.record(pipfileDependencySchema).optional(),
    source: import_zod.z.array(pipfileSourceSchema).optional(),
    scripts: import_zod.z.record(import_zod.z.string()).optional()
  })
);
var pipfileLockMetaSchema = import_zod.z.object({
  hash: import_zod.z.object({
    sha256: import_zod.z.string().optional()
  }).optional(),
  "pipfile-spec": import_zod.z.number().optional(),
  requires: import_zod.z.object({
    python_version: import_zod.z.string().optional(),
    python_full_version: import_zod.z.string().optional()
  }).optional(),
  sources: import_zod.z.array(pipfileSourceSchema).optional()
});
var pipfileLockLikeSchema = import_zod.z.record(
  import_zod.z.union([
    pipfileLockMetaSchema,
    import_zod.z.record(pipfileDependencyDetailSchema),
    import_zod.z.undefined()
  ])
).and(
  import_zod.z.object({
    _meta: pipfileLockMetaSchema.optional(),
    default: import_zod.z.record(pipfileDependencyDetailSchema).optional(),
    develop: import_zod.z.record(pipfileDependencyDetailSchema).optional()
  })
);

// src/manifest/pipfile/schema.ts
var PipfileDependencyDetailSchema = pipfileDependencyDetailSchema.passthrough();
var PipfileDependencySchema = pipfileDependencySchema;
var PipfileSourceSchema = pipfileSourceSchema.passthrough();
var PipfileLikeSchema = pipfileLikeSchema;
var PipfileLockMetaSchema = pipfileLockMetaSchema.passthrough();
var PipfileLockLikeSchema = pipfileLockLikeSchema;

// src/util/type.ts
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// src/manifest/pipfile-parser.ts
var PYPI_INDEX_NAME = "pypi";
function addDepSource(sources, dep) {
  if (!dep.source) {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(sources, dep.name)) {
    sources[dep.name].push(dep.source);
  } else {
    sources[dep.name] = [dep.source];
  }
}
function isPypiSource(source) {
  return typeof source?.name === "string" && source.name === PYPI_INDEX_NAME;
}
function processIndexSources(sources) {
  const hasPypi = sources.some(isPypiSource);
  const setExplicit = sources.length > 1 && hasPypi;
  const indexes = [];
  for (const source of sources) {
    if (isPypiSource(source)) {
      continue;
    }
    const entry = {
      name: source.name,
      url: source.url
    };
    if (setExplicit) {
      entry.explicit = true;
    }
    indexes.push(entry);
  }
  return indexes;
}
function buildUvToolSection(sources, indexes) {
  const uv = {};
  if (indexes.length > 0) {
    uv.index = indexes;
  }
  if (Object.keys(sources).length > 0) {
    uv.sources = sources;
  }
  return Object.keys(uv).length > 0 ? uv : null;
}
function pipfileDepsToRequirements(entries) {
  const deps = [];
  for (const [name, properties] of Object.entries(entries)) {
    const dep = pipfileDepToRequirement(name, properties);
    deps.push(dep);
  }
  return deps;
}
function pipfileDepToRequirement(spec, properties) {
  const [name, extrasFromName] = splitExtras(spec);
  const dep = { name };
  if (extrasFromName && extrasFromName.length > 0) {
    dep.extras = extrasFromName;
  }
  if (typeof properties === "string") {
    dep.version = properties;
  } else if (properties && typeof properties === "object") {
    if (properties.version) {
      dep.version = properties.version;
    }
    if (properties.extras) {
      dep.extras = mergeExtras(dep.extras, properties.extras);
    }
    if (properties.markers) {
      dep.markers = properties.markers;
    }
    const source = buildDependencySource(properties);
    if (source) {
      dep.source = source;
    }
  }
  return dep;
}
function pipfileLockDepsToRequirements(entries) {
  const deps = [];
  for (const [name, properties] of Object.entries(entries)) {
    const dep = pipfileLockDepToRequirement(name, properties);
    deps.push(dep);
  }
  return deps;
}
function pipfileLockDepToRequirement(spec, properties) {
  const [name, extrasFromName] = splitExtras(spec);
  const dep = { name };
  if (extrasFromName && extrasFromName.length > 0) {
    dep.extras = extrasFromName;
  }
  if (properties.version) {
    dep.version = properties.version;
  }
  if (properties.extras) {
    dep.extras = mergeExtras(dep.extras, properties.extras);
  }
  if (properties.markers) {
    dep.markers = properties.markers;
  }
  const source = buildDependencySource(properties);
  if (source) {
    dep.source = source;
  }
  return dep;
}
function buildDependencySource(properties) {
  const source = {};
  if (properties.index && properties.index !== PYPI_INDEX_NAME) {
    source.index = properties.index;
  }
  if (properties.git) {
    source.git = properties.git;
    if (properties.ref) {
      source.rev = properties.ref;
    }
  }
  if (properties.path) {
    source.path = properties.path;
    if (properties.editable) {
      source.editable = true;
    }
  }
  return Object.keys(source).length > 0 ? source : null;
}
function convertPipfileToPyprojectToml(pipfile) {
  const sources = {};
  const pyproject = {};
  const deps = [];
  for (const dep of pipfileDepsToRequirements(pipfile.packages || {})) {
    deps.push(formatPep508(dep));
    addDepSource(sources, dep);
  }
  if (deps.length > 0) {
    pyproject.project = {
      name: "app",
      version: "0.1.0",
      dependencies: deps
    };
  }
  const devDeps = [];
  for (const dep of pipfileDepsToRequirements(pipfile["dev-packages"] || {})) {
    devDeps.push(formatPep508(dep));
    addDepSource(sources, dep);
  }
  if (devDeps.length > 0) {
    pyproject["dependency-groups"] = {
      dev: devDeps
    };
  }
  const RESERVED_KEYS = /* @__PURE__ */ new Set([
    "packages",
    "dev-packages",
    "source",
    "scripts",
    "requires",
    "pipenv"
  ]);
  for (const [sectionName, value] of Object.entries(pipfile)) {
    if (RESERVED_KEYS.has(sectionName))
      continue;
    if (!isPlainObject(value))
      continue;
    const groupDeps = [];
    for (const dep of pipfileDepsToRequirements(
      value
    )) {
      groupDeps.push(formatPep508(dep));
      addDepSource(sources, dep);
    }
    if (groupDeps.length > 0) {
      pyproject["dependency-groups"] = {
        ...pyproject["dependency-groups"] || {},
        [sectionName]: groupDeps
      };
    }
  }
  const indexes = processIndexSources(pipfile.source ?? []);
  const uv = buildUvToolSection(sources, indexes);
  if (uv) {
    pyproject.tool = { uv };
  }
  return pyproject;
}
function convertPipfileLockToPyprojectToml(pipfileLock) {
  const sources = {};
  const pyproject = {};
  const pythonVersion = pipfileLock._meta?.requires?.python_version;
  const deps = [];
  for (const dep of pipfileLockDepsToRequirements(pipfileLock.default || {})) {
    deps.push(formatPep508(dep));
    addDepSource(sources, dep);
  }
  if (deps.length > 0 || pythonVersion) {
    const project = {
      name: "app",
      version: "0.1.0"
    };
    if (pythonVersion) {
      project["requires-python"] = `==${pythonVersion}.*`;
    }
    if (deps.length > 0) {
      project.dependencies = deps;
    }
    pyproject.project = project;
  }
  const devDeps = [];
  for (const dep of pipfileLockDepsToRequirements(pipfileLock.develop || {})) {
    devDeps.push(formatPep508(dep));
    addDepSource(sources, dep);
  }
  if (devDeps.length > 0) {
    pyproject["dependency-groups"] = {
      dev: devDeps
    };
  }
  const RESERVED_KEYS = /* @__PURE__ */ new Set(["_meta", "default", "develop"]);
  for (const [sectionName, value] of Object.entries(pipfileLock)) {
    if (RESERVED_KEYS.has(sectionName))
      continue;
    if (!isPlainObject(value))
      continue;
    const groupDeps = [];
    for (const dep of pipfileLockDepsToRequirements(
      value
    )) {
      groupDeps.push(formatPep508(dep));
      addDepSource(sources, dep);
    }
    if (groupDeps.length > 0) {
      pyproject["dependency-groups"] = {
        ...pyproject["dependency-groups"] || {},
        [sectionName]: groupDeps
      };
    }
  }
  const indexes = processIndexSources(pipfileLock._meta?.sources ?? []);
  const uv = buildUvToolSection(sources, indexes);
  if (uv) {
    pyproject.tool = { uv };
  }
  return pyproject;
}

// src/manifest/pyproject/schema.zod.ts
var import_zod4 = require("zod");

// src/manifest/uv-config/schema.zod.ts
var import_zod3 = require("zod");

// src/manifest/requirement/schema.zod.ts
var import_zod2 = require("zod");
var dependencySourceSchema = import_zod2.z.object({
  index: import_zod2.z.string().optional(),
  git: import_zod2.z.string().optional(),
  rev: import_zod2.z.string().optional(),
  path: import_zod2.z.string().optional(),
  editable: import_zod2.z.boolean().optional()
});
var normalizedRequirementSchema = import_zod2.z.object({
  name: import_zod2.z.string(),
  version: import_zod2.z.string().optional(),
  extras: import_zod2.z.array(import_zod2.z.string()).optional(),
  markers: import_zod2.z.string().optional(),
  url: import_zod2.z.string().optional(),
  hashes: import_zod2.z.array(import_zod2.z.string()).optional(),
  source: dependencySourceSchema.optional()
});
var hashDigestSchema = import_zod2.z.string();

// src/manifest/uv-config/schema.zod.ts
var uvConfigWorkspaceSchema = import_zod3.z.object({
  members: import_zod3.z.array(import_zod3.z.string()).optional(),
  exclude: import_zod3.z.array(import_zod3.z.string()).optional()
});
var uvIndexEntrySchema = import_zod3.z.object({
  name: import_zod3.z.string(),
  url: import_zod3.z.string(),
  default: import_zod3.z.boolean().optional(),
  explicit: import_zod3.z.boolean().optional(),
  format: import_zod3.z.string().optional()
});
var uvConfigSchema = import_zod3.z.object({
  sources: import_zod3.z.record(import_zod3.z.union([dependencySourceSchema, import_zod3.z.array(dependencySourceSchema)])).optional(),
  index: import_zod3.z.array(uvIndexEntrySchema).optional(),
  workspace: uvConfigWorkspaceSchema.optional(),
  "dev-dependencies": import_zod3.z.array(import_zod3.z.string()).optional()
});

// src/manifest/pyproject/schema.zod.ts
var pyProjectBuildSystemSchema = import_zod4.z.object({
  requires: import_zod4.z.array(import_zod4.z.string()),
  "build-backend": import_zod4.z.string().optional(),
  "backend-path": import_zod4.z.array(import_zod4.z.string()).optional()
});
var personSchema = import_zod4.z.object({
  name: import_zod4.z.string().optional(),
  email: import_zod4.z.string().optional()
});
var readmeObjectSchema = import_zod4.z.object({
  file: import_zod4.z.union([import_zod4.z.string(), import_zod4.z.array(import_zod4.z.string())]),
  content_type: import_zod4.z.string().optional()
});
var readmeSchema = import_zod4.z.union([import_zod4.z.string(), readmeObjectSchema]);
var licenseObjectSchema = import_zod4.z.object({
  text: import_zod4.z.string().optional(),
  file: import_zod4.z.string().optional()
});
var licenseSchema = import_zod4.z.union([import_zod4.z.string(), licenseObjectSchema]);
var pyProjectProjectSchema = import_zod4.z.object({
  name: import_zod4.z.string().optional(),
  version: import_zod4.z.string().optional(),
  description: import_zod4.z.string().optional(),
  readme: readmeSchema.optional(),
  keywords: import_zod4.z.array(import_zod4.z.string()).optional(),
  authors: import_zod4.z.array(personSchema).optional(),
  maintainers: import_zod4.z.array(personSchema).optional(),
  license: licenseSchema.optional(),
  classifiers: import_zod4.z.array(import_zod4.z.string()).optional(),
  urls: import_zod4.z.record(import_zod4.z.string()).optional(),
  dependencies: import_zod4.z.array(import_zod4.z.string()).optional(),
  "optional-dependencies": import_zod4.z.record(import_zod4.z.array(import_zod4.z.string())).optional(),
  dynamic: import_zod4.z.array(import_zod4.z.string()).optional(),
  "requires-python": import_zod4.z.string().optional(),
  scripts: import_zod4.z.record(import_zod4.z.string()).optional(),
  entry_points: import_zod4.z.record(import_zod4.z.record(import_zod4.z.string())).optional()
});
var dependencyGroupIncludeSchema = import_zod4.z.object({
  "include-group": import_zod4.z.string()
});
var dependencyGroupEntrySchema = import_zod4.z.union([
  import_zod4.z.string(),
  dependencyGroupIncludeSchema
]);
var pyProjectDependencyGroupsSchema = import_zod4.z.record(
  import_zod4.z.array(dependencyGroupEntrySchema)
);
var pyProjectToolSectionSchema = import_zod4.z.object({
  uv: uvConfigSchema.optional()
});
var pyProjectTomlSchema = import_zod4.z.object({
  project: pyProjectProjectSchema.optional(),
  "build-system": pyProjectBuildSystemSchema.optional(),
  "dependency-groups": pyProjectDependencyGroupsSchema.optional(),
  tool: pyProjectToolSectionSchema.optional()
});

// src/manifest/pyproject/schema.ts
var PyProjectBuildSystemSchema = pyProjectBuildSystemSchema.passthrough();
var PersonSchema = personSchema.passthrough();
var ReadmeObjectSchema = readmeObjectSchema.passthrough();
var ReadmeSchema = readmeSchema;
var LicenseObjectSchema = licenseObjectSchema.passthrough();
var LicenseSchema = licenseSchema;
var PyProjectProjectSchema = pyProjectProjectSchema.passthrough();
var PyProjectDependencyGroupsSchema = pyProjectDependencyGroupsSchema;
var PyProjectToolSectionSchema = pyProjectToolSectionSchema.passthrough();
var PyProjectTomlSchema = pyProjectTomlSchema.passthrough();

// src/manifest/requirements-txt-parser.ts
var import_posix2 = require("path/posix");
var PRIMARY_INDEX_NAME = "primary";
var EXTRA_INDEX_PREFIX = "extra-";
var FIND_LINKS_PREFIX = "find-links-";
async function parseWithWasm(content, readFile4, workingDir) {
  const wasm = await importWasmModule();
  const resolvedDir = workingDir ?? "/";
  if (readFile4) {
    return readFileStorage.run(
      { readFile: readFile4, workingDir: resolvedDir },
      () => wasm.parseRequirementsTxt(content, resolvedDir, void 0)
    );
  }
  return wasm.parseRequirementsTxt(content, workingDir ?? void 0, void 0);
}
function wasmEntryToNormalized(entry, editable) {
  let name = entry.name || "";
  if (!name && entry.url) {
    const urlPath = entry.url.replace(/^file:\/\//, "");
    const basename = urlPath.replace(/\/$/, "").split("/").pop();
    if (basename && !basename.includes(".")) {
      name = basename;
    }
  }
  const req = {
    name
  };
  if (entry.versionSpec) {
    req.version = entry.versionSpec;
  }
  if (entry.extras.length > 0) {
    req.extras = entry.extras;
  }
  if (entry.markers) {
    req.markers = entry.markers;
  }
  if (entry.vcs) {
    const source = {
      git: entry.vcs.url
    };
    if (entry.vcs.rev) {
      source.rev = entry.vcs.rev;
    }
    if (editable) {
      source.editable = true;
    }
    req.source = source;
  }
  if (entry.url) {
    if (entry.url.startsWith("file://") && !entry.vcs) {
      const given = entry.givenUrl ?? entry.url;
      const path4 = given.startsWith("file://") ? given.slice("file://".length) : given;
      req.source = { path: path4, ...editable ? { editable: true } : {} };
    } else {
      req.url = entry.url;
    }
  }
  if (entry.hashes.length > 0) {
    req.hashes = entry.hashes;
  }
  return req;
}
function rebasePath(p, workingDir, packageRoot) {
  if (!workingDir || !packageRoot || workingDir === packageRoot)
    return p;
  if ((0, import_posix2.isAbsolute)(p))
    return p;
  const abs = (0, import_posix2.join)(workingDir, p);
  const rel = (0, import_posix2.relative)(packageRoot, abs);
  if ((0, import_posix2.isAbsolute)(rel))
    return rel;
  if (rel.startsWith(".."))
    return rel;
  return "./" + rel;
}
async function convertRequirementsToPyprojectToml(fileContent, options) {
  const pyproject = {};
  const parsed = await parseRequirementsFile(fileContent, options);
  const deps = [];
  const sources = {};
  const { workingDir, packageRoot } = options ?? {};
  for (const req of parsed.requirements) {
    deps.push(formatPep508(req));
    if (req.source) {
      const source = { ...req.source };
      if (source.path) {
        source.path = rebasePath(source.path, workingDir, packageRoot);
      }
      if (Object.prototype.hasOwnProperty.call(sources, req.name)) {
        sources[req.name].push(source);
      } else {
        sources[req.name] = [source];
      }
    }
  }
  if (deps.length > 0) {
    pyproject.project = {
      name: "app",
      version: "0.1.0",
      dependencies: deps
    };
  }
  const uv = {};
  const indexes = buildIndexEntries(parsed.pipOptions);
  if (indexes.length > 0) {
    uv.index = indexes;
  }
  if (Object.keys(sources).length > 0) {
    uv.sources = sources;
  }
  if (Object.keys(uv).length > 0) {
    pyproject.tool = { uv };
  }
  return pyproject;
}
function buildIndexEntries(pipOptions) {
  const indexes = [];
  if (pipOptions.indexUrl) {
    indexes.push({
      name: PRIMARY_INDEX_NAME,
      url: pipOptions.indexUrl,
      default: true
    });
  }
  for (let i = 0; i < pipOptions.extraIndexUrls.length; i++) {
    indexes.push({
      name: `${EXTRA_INDEX_PREFIX}${i + 1}`,
      url: pipOptions.extraIndexUrls[i]
    });
  }
  if (pipOptions.findLinks) {
    for (let i = 0; i < pipOptions.findLinks.length; i++) {
      indexes.push({
        name: `${FIND_LINKS_PREFIX}${i + 1}`,
        url: pipOptions.findLinks[i],
        format: "flat"
      });
    }
  }
  return indexes;
}
async function parseRequirementsFile(fileContent, options) {
  const wasmResult = await parseWithWasm(
    fileContent,
    options?.readFile,
    options?.workingDir
  );
  return processWasmResult(wasmResult);
}
function processWasmResult(wasmResult) {
  const normalized = [];
  for (const entry of wasmResult.requirements) {
    normalized.push(wasmEntryToNormalized(entry, false));
  }
  for (const entry of wasmResult.editables) {
    const norm = wasmEntryToNormalized(entry, true);
    if (!norm.source && !entry.vcs) {
      norm.source = { path: entry.pep508, editable: true };
    } else if (norm.source && !norm.source.editable) {
      norm.source.editable = true;
    }
    normalized.push(norm);
  }
  const pipOptions = {
    indexUrl: wasmResult.indexUrl || void 0,
    extraIndexUrls: [...wasmResult.extraIndexUrls],
    findLinks: wasmResult.findLinks.length > 0 ? [...wasmResult.findLinks] : void 0,
    noIndex: wasmResult.noIndex || void 0
  };
  return {
    requirements: normalized,
    pipOptions
  };
}

// src/manifest/uv-config/schema.ts
var UvConfigWorkspaceSchema = uvConfigWorkspaceSchema.passthrough();
var UvIndexEntrySchema = uvIndexEntrySchema.passthrough();
var UvConfigSchema = uvConfigSchema.passthrough();

// src/manifest/python-specifiers.ts
var PythonImplementation = {
  knownLongNames() {
    return {
      python: "cpython",
      cpython: "cpython",
      pypy: "pypy",
      pyodide: "pyodide",
      graalpy: "graalpy"
    };
  },
  knownShortNames() {
    return { cp: "cpython", pp: "pypy", gp: "graalpy" };
  },
  knownNames() {
    return { ...this.knownLongNames(), ...this.knownShortNames() };
  },
  parse(s) {
    const impl = this.knownNames()[s];
    if (impl !== void 0) {
      return impl;
    } else {
      return { implementation: s };
    }
  },
  isUnknown(impl) {
    return impl.implementation !== void 0;
  },
  toString(impl) {
    switch (impl) {
      case "cpython":
        return "cpython";
      case "pypy":
        return "pypy";
      case "pyodide":
        return "pyodide";
      case "graalpy":
        return "graalpy";
      default:
        return impl.implementation;
    }
  },
  toStringPretty(impl) {
    switch (impl) {
      case "cpython":
        return "CPython";
      case "pypy":
        return "PyPy";
      case "pyodide":
        return "PyOdide";
      case "graalpy":
        return "GraalPy";
      default:
        return impl.implementation;
    }
  }
};
var PythonVariant = {
  parse(s) {
    switch (s) {
      case "default":
        return "default";
      case "d":
      case "debug":
        return "debug";
      case "freethreaded":
        return "freethreaded";
      case "t":
        return "freethreaded";
      case "gil":
        return "gil";
      case "freethreaded+debug":
        return "freethreaded+debug";
      case "td":
        return "freethreaded+debug";
      case "gil+debug":
        return "gil+debug";
      default:
        return { type: "unknown", variant: s };
    }
  },
  toString(v) {
    switch (v) {
      case "default":
        return "default";
      case "debug":
        return "debug";
      case "freethreaded":
        return "freethreaded";
      case "gil":
        return "gil";
      case "freethreaded+debug":
        return "freethreaded+debug";
      case "gil+debug":
        return "gil+debug";
      default:
        return v.variant;
    }
  }
};
var PythonVersion = {
  toString(version) {
    let verstr = `${version.major}.${version.minor}`;
    if (version.patch !== void 0) {
      verstr = `${verstr}.${version.patch}`;
    }
    if (version.prerelease !== void 0) {
      verstr = `${verstr}${version.prerelease}`;
    }
    return verstr;
  }
};
var PythonBuild = {
  toString(build) {
    const parts = [
      PythonImplementation.toString(build.implementation),
      `${PythonVersion.toString(build.version)}+${PythonVariant.toString(build.variant)}`,
      build.os,
      build.architecture,
      build.libc
    ];
    return parts.join("-");
  }
};

// src/manifest/uv-python-version-parser.ts
function pythonRequestFromConstraint(constraint) {
  return {
    implementation: "cpython",
    version: {
      constraint,
      variant: "default"
    }
  };
}
function parsePythonVersionFile(content) {
  const lines = content.split(/\r?\n/);
  const requests = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed)
      continue;
    if (trimmed.startsWith("#"))
      continue;
    const parsed = parseUvPythonRequest(trimmed);
    if (parsed != null) {
      requests.push(parsed);
    }
  }
  if (requests.length === 0) {
    return null;
  } else {
    return requests;
  }
}
function parseUvPythonRequest(input) {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  const lowercase = raw.toLowerCase();
  if (lowercase === "any" || lowercase === "default") {
    return {};
  }
  for (const [implName, implementation] of Object.entries(
    PythonImplementation.knownNames()
  )) {
    if (lowercase.startsWith(implName)) {
      let rest = lowercase.substring(implName.length);
      if (rest.length === 0) {
        return {
          implementation
        };
      }
      if (rest[0] === "@") {
        rest = rest.substring(1);
      }
      const version2 = parseVersionRequest(rest);
      if (version2 != null) {
        return {
          implementation,
          version: version2
        };
      }
    }
  }
  const version = parseVersionRequest(lowercase);
  if (version != null) {
    return {
      implementation: "cpython",
      version
    };
  }
  return tryParsePlatformRequest(lowercase);
}
function parseVersionRequest(input) {
  const [version, variant] = parseVariantSuffix(input);
  let parsedVer = (0, import_pep440.parse)(version);
  if (parsedVer != null) {
    if (parsedVer.release.length === 1) {
      const converted = splitWheelTagVersion(version);
      if (converted != null) {
        const convertedVer = (0, import_pep440.parse)(converted);
        if (convertedVer != null) {
          parsedVer = convertedVer;
        }
      }
    }
    return {
      constraint: pep440ConstraintFromVersion(parsedVer),
      variant
    };
  }
  const parsedConstr = (0, import_specifier.parse)(version);
  if (parsedConstr?.length) {
    return {
      constraint: parsedConstr,
      variant
    };
  }
  return null;
}
function splitWheelTagVersion(version) {
  if (!/^\d+$/.test(version)) {
    return null;
  }
  if (version.length < 2) {
    return null;
  }
  const major = version[0];
  const minorStr = version.substring(1);
  const minor = parseInt(minorStr, 10);
  if (isNaN(minor) || minor > 255) {
    return null;
  }
  return `${major}.${minor}`;
}
function rfindNumericChar(s) {
  for (let i = s.length - 1; i >= 0; i--) {
    const code = s.charCodeAt(i);
    if (code >= 48 && code <= 57)
      return i;
  }
  return -1;
}
function parseVariantSuffix(vrs) {
  let pos = rfindNumericChar(vrs);
  if (pos < 0) {
    return [vrs, "default"];
  }
  pos += 1;
  if (pos + 1 > vrs.length) {
    return [vrs, "default"];
  }
  let variant = vrs.substring(pos);
  if (variant[0] === "+") {
    variant = variant.substring(1);
  }
  const prefix = vrs.substring(0, pos);
  return [prefix, PythonVariant.parse(variant)];
}
function tryParsePlatformRequest(raw) {
  const parts = raw.split("-");
  let partIdx = 0;
  const state = ["implementation", "version", "os", "arch", "libc", "end"];
  let stateIdx = 0;
  let implementation;
  let version;
  let os;
  let arch;
  let libc;
  let implOrVersionFailed = false;
  for (; ; ) {
    if (partIdx >= parts.length || state[stateIdx] === "end") {
      break;
    }
    const part = parts[partIdx].toLowerCase();
    if (part.length === 0) {
      break;
    }
    switch (state[stateIdx]) {
      case "implementation":
        if (part === "any") {
          partIdx += 1;
          stateIdx += 1;
          continue;
        }
        implementation = PythonImplementation.parse(part);
        if (PythonImplementation.isUnknown(implementation)) {
          implementation = void 0;
          stateIdx += 1;
          implOrVersionFailed = true;
          continue;
        }
        stateIdx += 1;
        partIdx += 1;
        break;
      case "version":
        if (part === "any") {
          partIdx += 1;
          stateIdx += 1;
          continue;
        }
        version = parseVersionRequest(part);
        if (version == null) {
          version = void 0;
          stateIdx += 1;
          implOrVersionFailed = true;
          continue;
        }
        stateIdx += 1;
        partIdx += 1;
        break;
      case "os":
        if (part === "any") {
          partIdx += 1;
          stateIdx += 1;
          continue;
        }
        os = part;
        stateIdx += 1;
        partIdx += 1;
        break;
      case "arch":
        if (part === "any") {
          partIdx += 1;
          stateIdx += 1;
          continue;
        }
        arch = part;
        stateIdx += 1;
        partIdx += 1;
        break;
      case "libc":
        if (part === "any") {
          partIdx += 1;
          stateIdx += 1;
          continue;
        }
        libc = part;
        stateIdx += 1;
        partIdx += 1;
        break;
      default:
        break;
    }
  }
  if (implOrVersionFailed && implementation === void 0 && version === void 0) {
    return null;
  }
  let platform;
  if (os !== void 0 || arch !== void 0 || libc !== void 0) {
    platform = {
      os,
      arch,
      libc
    };
  }
  return { implementation, version, platform };
}

// src/manifest/package.ts
var PythonConfigKind = /* @__PURE__ */ ((PythonConfigKind2) => {
  PythonConfigKind2["PythonVersion"] = ".python-version";
  return PythonConfigKind2;
})(PythonConfigKind || {});
var PythonManifestKind = /* @__PURE__ */ ((PythonManifestKind2) => {
  PythonManifestKind2["PyProjectToml"] = "pyproject.toml";
  return PythonManifestKind2;
})(PythonManifestKind || {});
var PythonLockFileKind = /* @__PURE__ */ ((PythonLockFileKind2) => {
  PythonLockFileKind2["UvLock"] = "uv.lock";
  PythonLockFileKind2["PylockToml"] = "pylock.toml";
  return PythonLockFileKind2;
})(PythonLockFileKind || {});
var PythonManifestConvertedKind = /* @__PURE__ */ ((PythonManifestConvertedKind2) => {
  PythonManifestConvertedKind2["Pipfile"] = "Pipfile";
  PythonManifestConvertedKind2["PipfileLock"] = "Pipfile.lock";
  PythonManifestConvertedKind2["RequirementsIn"] = "requirements.in";
  PythonManifestConvertedKind2["RequirementsTxt"] = "requirements.txt";
  return PythonManifestConvertedKind2;
})(PythonManifestConvertedKind || {});
async function discoverPythonPackage({
  entrypointDir,
  rootDir
}) {
  const entrypointPath = normalizePath(entrypointDir);
  const rootPath = normalizePath(rootDir);
  let prefix = import_node_path5.default.relative(rootPath, entrypointPath);
  if (prefix.startsWith("..")) {
    throw new PythonAnalysisError({
      message: "Entrypoint directory outside of repository root",
      code: "PYTHON_INVALID_ENTRYPOINT_PATH"
    });
  }
  const manifests = [];
  let configs = [];
  for (; ; ) {
    const prefixConfigs = await loadPythonConfigs(rootPath, prefix);
    if (Object.keys(prefixConfigs).length !== 0) {
      configs.push(prefixConfigs);
    }
    const prefixManifest = await loadPythonManifest(rootPath, prefix);
    if (prefixManifest != null) {
      manifests.push(prefixManifest);
      if (prefixManifest.isRoot) {
        break;
      }
    }
    if (prefix === "" || prefix === ".") {
      break;
    }
    prefix = import_node_path5.default.dirname(prefix);
  }
  let entrypointManifest;
  let workspaceManifest;
  let workspaceLockFile;
  if (manifests.length === 0) {
    const requiresPython2 = computeRequiresPython(void 0, void 0, configs);
    return {
      configs,
      requiresPython: requiresPython2
    };
  } else {
    entrypointManifest = manifests[0];
    const entrypointWorkspaceManifest = findWorkspaceManifestFor(
      entrypointManifest,
      manifests
    );
    workspaceManifest = entrypointWorkspaceManifest;
    workspaceLockFile = entrypointWorkspaceManifest.lockFile;
    configs = configs.filter(
      (config) => Object.values(config).some(
        (cfg) => cfg !== void 0 && isSubpath(
          import_node_path5.default.dirname(cfg.path),
          import_node_path5.default.dirname(entrypointWorkspaceManifest.path)
        )
      )
    );
  }
  const requiresPython = computeRequiresPython(
    entrypointManifest,
    workspaceManifest,
    configs
  );
  return {
    manifest: entrypointManifest,
    workspaceManifest,
    workspaceLockFile,
    configs,
    requiresPython
  };
}
function computeRequiresPython(manifest, workspaceManifest, configs) {
  const constraints = [];
  let hasPythonVersionFile = false;
  for (const configSet of configs) {
    const pythonVersionConfig = configSet[".python-version" /* PythonVersion */];
    if (pythonVersionConfig !== void 0) {
      constraints.push({
        request: pythonVersionConfig.data,
        source: pythonVersionConfig.path,
        prettySource: pythonVersionConfig.path,
        specifier: pythonVersionConfig.specifier
      });
      hasPythonVersionFile = true;
      break;
    }
  }
  if (!hasPythonVersionFile) {
    const manifestRequiresPython = manifest?.data.project?.["requires-python"];
    if (manifestRequiresPython) {
      const parsed = (0, import_specifier.parse)(manifestRequiresPython);
      if (parsed?.length) {
        const request = pythonRequestFromConstraint(parsed);
        constraints.push({
          request: [request],
          source: manifest.path,
          prettySource: `"requires-python" key in ${manifest.path}`,
          specifier: manifestRequiresPython
        });
      }
    } else {
      const workspaceRequiresPython = workspaceManifest?.data.project?.["requires-python"];
      if (workspaceRequiresPython) {
        const parsed = (0, import_specifier.parse)(workspaceRequiresPython);
        if (parsed?.length) {
          const request = pythonRequestFromConstraint(parsed);
          constraints.push({
            request: [request],
            source: workspaceManifest.path,
            prettySource: `"requires-python" key in ${workspaceManifest.path}`,
            specifier: workspaceRequiresPython
          });
        }
      }
    }
  }
  return constraints;
}
function findWorkspaceManifestFor(manifest, manifestStack) {
  if (manifest.isRoot) {
    return manifest;
  }
  for (const parentManifest of manifestStack) {
    if (parentManifest.path === manifest.path) {
      continue;
    }
    const workspace = parentManifest.data.tool?.uv?.workspace;
    if (workspace !== void 0) {
      let members = workspace.members ?? [];
      if (!Array.isArray(members)) {
        members = [];
      }
      let exclude = workspace.exclude ?? [];
      if (!Array.isArray(exclude)) {
        exclude = [];
      }
      const entrypointRelPath = import_node_path5.default.relative(
        import_node_path5.default.dirname(parentManifest.path),
        import_node_path5.default.dirname(manifest.path)
      );
      if (members.length > 0 && members.some(
        (pat) => (0, import_minimatch.match)([entrypointRelPath], pat).length > 0
      ) && !exclude.some(
        (pat) => (0, import_minimatch.match)([entrypointRelPath], pat).length > 0
      )) {
        return parentManifest;
      }
    }
  }
  return manifest;
}
async function loadPythonManifest(root, prefix) {
  let manifest = null;
  const pyproject = await maybeLoadPyProjectToml(root, prefix);
  if (pyproject != null) {
    manifest = pyproject;
    manifest.isRoot = pyproject.data.tool?.uv?.workspace !== void 0;
  } else {
    const pipfileLockPyProject = await maybeLoadPipfileLock(root, prefix);
    if (pipfileLockPyProject != null) {
      manifest = pipfileLockPyProject;
      manifest.isRoot = true;
    } else {
      const pipfilePyProject = await maybeLoadPipfile(root, prefix);
      if (pipfilePyProject != null) {
        manifest = pipfilePyProject;
        manifest.isRoot = true;
      } else {
        for (const fileName of [
          "requirements.frozen.txt",
          "requirements-frozen.txt",
          "requirements.txt",
          "requirements.in",
          import_node_path5.default.join("requirements", "prod.txt")
        ]) {
          const requirementsTxtManifest = await maybeLoadRequirementsTxt(
            root,
            prefix,
            fileName
          );
          if (requirementsTxtManifest != null) {
            manifest = requirementsTxtManifest;
            manifest.isRoot = true;
            break;
          }
        }
      }
    }
  }
  return manifest;
}
async function maybeLoadLockFile(root, subdir) {
  const uvLockRelPath = import_node_path5.default.join(subdir, "uv.lock");
  const uvLockPath = import_node_path5.default.join(root, uvLockRelPath);
  const uvLockContent = await readFileTextIfExists(uvLockPath);
  if (uvLockContent != null) {
    return { path: uvLockRelPath, kind: "uv.lock" /* UvLock */ };
  }
  const pylockRelPath = import_node_path5.default.join(subdir, "pylock.toml");
  const pylockPath = import_node_path5.default.join(root, pylockRelPath);
  const pylockContent = await readFileTextIfExists(pylockPath);
  if (pylockContent != null) {
    return { path: pylockRelPath, kind: "pylock.toml" /* PylockToml */ };
  }
  return void 0;
}
async function maybeLoadPyProjectToml(root, subdir) {
  const pyprojectTomlRelPath = import_node_path5.default.join(subdir, "pyproject.toml");
  const pyprojectTomlPath = import_node_path5.default.join(root, pyprojectTomlRelPath);
  let pyproject;
  try {
    pyproject = await readConfigIfExists(
      pyprojectTomlPath,
      PyProjectTomlSchema
    );
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      error.path = pyprojectTomlRelPath;
      throw error;
    }
    throw new PythonAnalysisError({
      message: `could not parse pyproject.toml: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_PYPROJECT_PARSE_ERROR",
      path: pyprojectTomlRelPath
    });
  }
  if (pyproject == null) {
    return null;
  }
  const uvTomlRelPath = import_node_path5.default.join(subdir, "uv.toml");
  const uvTomlPath = import_node_path5.default.join(root, uvTomlRelPath);
  let uvToml;
  try {
    uvToml = await readConfigIfExists(uvTomlPath, UvConfigSchema);
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      error.path = uvTomlRelPath;
      throw error;
    }
    throw new PythonAnalysisError({
      message: `could not parse uv.toml: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_UV_CONFIG_PARSE_ERROR",
      path: uvTomlRelPath
    });
  }
  if (uvToml != null) {
    if (pyproject.tool == null) {
      pyproject.tool = { uv: uvToml };
    } else {
      pyproject.tool.uv = uvToml;
    }
  }
  const lockFile = await maybeLoadLockFile(root, subdir);
  return {
    path: pyprojectTomlRelPath,
    data: pyproject,
    lockFile
  };
}
async function maybeLoadPipfile(root, subdir) {
  const pipfileRelPath = import_node_path5.default.join(subdir, "Pipfile");
  const pipfilePath = import_node_path5.default.join(root, pipfileRelPath);
  let pipfile;
  try {
    pipfile = await readConfigIfExists(pipfilePath, PipfileLikeSchema, ".toml");
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      error.path = pipfileRelPath;
      throw error;
    }
    throw new PythonAnalysisError({
      message: `could not parse Pipfile: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_PIPFILE_PARSE_ERROR",
      path: pipfileRelPath
    });
  }
  if (pipfile == null) {
    return null;
  }
  const pyproject = convertPipfileToPyprojectToml(pipfile);
  return {
    path: pipfileRelPath,
    data: pyproject,
    origin: {
      kind: "Pipfile" /* Pipfile */,
      path: pipfileRelPath
    }
  };
}
async function maybeLoadPipfileLock(root, subdir) {
  const pipfileLockRelPath = import_node_path5.default.join(subdir, "Pipfile.lock");
  const pipfileLockPath = import_node_path5.default.join(root, pipfileLockRelPath);
  let pipfileLock;
  try {
    pipfileLock = await readConfigIfExists(
      pipfileLockPath,
      PipfileLockLikeSchema,
      ".json"
    );
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      error.path = pipfileLockRelPath;
      throw error;
    }
    throw new PythonAnalysisError({
      message: `could not parse Pipfile.lock: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_PIPFILE_LOCK_PARSE_ERROR",
      path: pipfileLockRelPath
    });
  }
  if (pipfileLock == null) {
    return null;
  }
  const pyproject = convertPipfileLockToPyprojectToml(pipfileLock);
  return {
    path: pipfileLockRelPath,
    data: pyproject,
    origin: {
      kind: "Pipfile.lock" /* PipfileLock */,
      path: pipfileLockRelPath
    }
  };
}
async function maybeLoadRequirementsTxt(root, subdir, fileName) {
  const requirementsTxtRelPath = import_node_path5.default.join(subdir, fileName);
  const requirementsTxtPath = import_node_path5.default.join(root, requirementsTxtRelPath);
  const requirementsContent = await readFileTextIfExists(requirementsTxtPath);
  if (requirementsContent == null) {
    return null;
  }
  try {
    const pyproject = await convertRequirementsToPyprojectToml(
      requirementsContent,
      {
        workingDir: import_node_path5.default.join(root, subdir),
        packageRoot: root
      }
    );
    return {
      path: requirementsTxtRelPath,
      data: pyproject,
      origin: {
        kind: "requirements.txt" /* RequirementsTxt */,
        path: requirementsTxtRelPath
      }
    };
  } catch (error) {
    if (error instanceof PythonAnalysisError) {
      error.path = requirementsTxtRelPath;
      if (!error.fileContent) {
        error.fileContent = requirementsContent;
      }
      throw error;
    }
    throw new PythonAnalysisError({
      message: `could not parse ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_REQUIREMENTS_PARSE_ERROR",
      path: requirementsTxtRelPath,
      fileContent: requirementsContent
    });
  }
}
async function loadPythonConfigs(root, prefix) {
  const configs = {};
  const pythonRequest = await maybeLoadPythonRequest(root, prefix);
  if (pythonRequest != null) {
    configs[".python-version" /* PythonVersion */] = pythonRequest;
  }
  return configs;
}
async function maybeLoadPythonRequest(root, subdir) {
  const dotPythonVersionRelPath = import_node_path5.default.join(subdir, ".python-version");
  const dotPythonVersionPath = import_node_path5.default.join(
    root,
    dotPythonVersionRelPath
  );
  const data = await readFileTextIfExists(dotPythonVersionPath);
  if (data == null) {
    return null;
  }
  const pyreq = parsePythonVersionFile(data);
  if (pyreq == null) {
    throw new PythonAnalysisError({
      message: `could not parse .python-version file: no valid Python version requests found`,
      code: "PYTHON_VERSION_FILE_PARSE_ERROR",
      path: dotPythonVersionRelPath
    });
  }
  return {
    kind: ".python-version" /* PythonVersion */,
    path: dotPythonVersionRelPath,
    data: pyreq,
    specifier: data.trim()
  };
}

// src/manifest/serialize.ts
var import_smol_toml2 = __toESM(require("smol-toml"), 1);
function stringifyManifest(data) {
  return import_smol_toml2.default.stringify(data);
}
function createMinimalManifest(options = {}) {
  const {
    name = "app",
    version = "0.1.0",
    requiresPython,
    dependencies = []
  } = options;
  return {
    project: {
      name,
      version,
      ...requiresPython && { "requires-python": requiresPython },
      dependencies,
      classifiers: ["Private :: Do Not Upload"]
    }
  };
}

// src/manifest/uv-lock-parser.ts
var import_smol_toml3 = __toESM(require("smol-toml"), 1);
function parseUvLock(content, path4) {
  let parsed;
  try {
    parsed = import_smol_toml3.default.parse(content);
  } catch (error) {
    throw new PythonAnalysisError({
      message: `Could not parse uv.lock: ${error instanceof Error ? error.message : String(error)}`,
      code: "PYTHON_UV_LOCK_PARSE_ERROR",
      path: path4,
      fileContent: content
    });
  }
  const packages = (parsed.package ?? []).filter((pkg) => pkg.name && pkg.version).map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    source: pkg.source,
    wheels: (pkg.wheels ?? []).map((w) => ({ url: w.url })),
    ...pkg.dependencies ? { dependencies: pkg.dependencies } : {}
  }));
  return { version: parsed.version, packages };
}
var PUBLIC_PYPI_PATTERNS = [
  "https://pypi.org",
  "https://files.pythonhosted.org",
  "pypi.org"
];
function isPublicPyPIRegistry(registryUrl) {
  if (!registryUrl)
    return true;
  const normalized = registryUrl.toLowerCase();
  return PUBLIC_PYPI_PATTERNS.some((pattern) => normalized.includes(pattern));
}
function isPrivatePackageSource(source) {
  if (!source)
    return false;
  if (source.git)
    return true;
  if (source.path)
    return true;
  if (source.editable)
    return true;
  if (source.url)
    return true;
  if (source.virtual)
    return true;
  if (source.registry && !isPublicPyPIRegistry(source.registry)) {
    return true;
  }
  return false;
}
function normalizePackageName2(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}
function classifyPackages(options) {
  const { lockFile, excludePackages = [] } = options;
  const privatePackages = [];
  const publicPackages = [];
  const packageVersions = {};
  const excludeSet = new Set(excludePackages.map(normalizePackageName2));
  for (const pkg of lockFile.packages) {
    if (excludeSet.has(normalizePackageName2(pkg.name))) {
      continue;
    }
    packageVersions[pkg.name] = pkg.version;
    if (isPrivatePackageSource(pkg.source)) {
      privatePackages.push(pkg.name);
    } else {
      publicPackages.push(pkg.name);
    }
  }
  return { privatePackages, publicPackages, packageVersions };
}

// src/manifest/wheel-compat.ts
async function isWheelCompatible(wheelFilename, pythonMajor, pythonMinor, osName, archName, osMajor, osMinor) {
  const mod = await importWasmModule();
  return mod.isWheelCompatible(
    wheelFilename,
    pythonMajor,
    pythonMinor,
    osName,
    archName,
    osMajor,
    osMinor
  );
}
async function evaluateMarker(marker, pythonMajor, pythonMinor, sysPlatform, platformMachine) {
  const mod = await importWasmModule();
  return mod.evaluateMarker(
    marker,
    pythonMajor,
    pythonMinor,
    sysPlatform,
    platformMachine
  );
}

// src/manifest/python-selector.ts
function selectPython(constraints, available) {
  const warnings = [];
  const errors = [];
  if (constraints.length === 0) {
    return {
      build: available.length > 0 ? available[0] : null,
      errors: available.length === 0 ? ["No Python builds available"] : void 0
    };
  }
  const constraintMatches = /* @__PURE__ */ new Map();
  for (let i = 0; i < constraints.length; i++) {
    constraintMatches.set(i, []);
  }
  for (const build of available) {
    let matchesAll = true;
    for (let i = 0; i < constraints.length; i++) {
      const constraint = constraints[i];
      if (buildMatchesConstraint(build, constraint)) {
        constraintMatches.get(i)?.push(build);
      } else {
        matchesAll = false;
      }
    }
    if (matchesAll) {
      return {
        build,
        warnings: warnings.length > 0 ? warnings : void 0
      };
    }
  }
  if (constraints.length > 1) {
    const constraintsWithMatches = [];
    for (let i = 0; i < constraints.length; i++) {
      const matches = constraintMatches.get(i) ?? [];
      if (matches.length > 0) {
        constraintsWithMatches.push(i);
      }
    }
    if (constraintsWithMatches.length > 1) {
      const sources = constraintsWithMatches.map(
        (i) => constraints[i].prettySource
      );
      warnings.push(
        `Python version constraints may not overlap: ${sources.join(", ")}`
      );
    }
  }
  const constraintDescriptions = constraints.map((c) => c.prettySource).join(", ");
  errors.push(
    `No Python build satisfies all constraints: ${constraintDescriptions}`
  );
  return {
    build: null,
    errors,
    warnings: warnings.length > 0 ? warnings : void 0
  };
}
function selectPythonVersion({
  constraints,
  availableBuilds,
  allBuilds,
  defaultBuild,
  majorMinorOnly,
  legacyTildeEquals
}) {
  const source = constraints?.[0]?.source;
  if (!constraints || constraints.length === 0) {
    return { build: defaultBuild };
  }
  let effectiveConstraints = majorMinorOnly ? constraints.map((c) => ({
    ...c,
    request: c.request.map(truncatePatchVersionsInRequest)
  })) : constraints;
  if (legacyTildeEquals) {
    effectiveConstraints = effectiveConstraints.map((c) => ({
      ...c,
      request: c.request.map(legacyTildeEqualsTransform)
    }));
  }
  const result = selectPython(effectiveConstraints, availableBuilds);
  if (result.build) {
    return { build: result.build, source };
  }
  const allResult = selectPython(effectiveConstraints, allBuilds);
  if (allResult.build) {
    const version = pythonVersionToString(allResult.build.version);
    return {
      build: defaultBuild,
      source,
      notAvailable: { build: allResult.build, version }
    };
  }
  const versionString = extractConstraintVersionString(constraints);
  return {
    build: defaultBuild,
    source,
    invalidConstraint: { versionString }
  };
}
function extractConstraintVersionString(constraints) {
  for (const c of constraints) {
    for (const req of c.request) {
      if (req.version?.constraint && req.version.constraint.length > 0) {
        const specs = req.version.constraint;
        if (specs.length === 1 && specs[0].operator === "==" && (!specs[0].prefix || specs[0].prefix === ".*")) {
          return specs[0].version;
        }
        return pep440ConstraintsToString(specs);
      }
    }
  }
  return "unknown";
}
function truncatePatchVersionsInRequest(req) {
  if (!req.version?.constraint || req.version.constraint.length === 0) {
    return req;
  }
  const newConstraints = [];
  for (const c of req.version.constraint) {
    const result = truncatePatchConstraint(c);
    if (result !== null) {
      newConstraints.push(result);
    }
  }
  const newVersion = {
    ...req.version,
    constraint: newConstraints
  };
  return { ...req, version: newVersion };
}
function truncatePatchConstraint(c) {
  if (c.operator === "===") {
    return c;
  }
  const parts = c.version.split(".");
  if (parts.length < 3) {
    return c;
  }
  const majorMinor = parts.slice(0, 2).join(".");
  const patch = parseInt(parts[2], 10);
  switch (c.operator) {
    case "==":
      return { operator: "==", version: majorMinor, prefix: ".*" };
    case "!=":
      return null;
    case "~=":
      return { operator: "==", version: majorMinor, prefix: ".*" };
    case ">=":
      return { operator: ">=", version: majorMinor, prefix: "" };
    case "<=":
      return { operator: "<=", version: majorMinor, prefix: "" };
    case ">":
      return patch === 0 ? { operator: ">", version: majorMinor, prefix: "" } : { operator: ">=", version: majorMinor, prefix: "" };
    case "<":
      return patch === 0 ? { operator: "<", version: majorMinor, prefix: "" } : { operator: "<=", version: majorMinor, prefix: "" };
    default:
      return c;
  }
}
function legacyTildeEqualsTransform(req) {
  if (!req.version?.constraint || req.version.constraint.length === 0) {
    return req;
  }
  const newConstraints = req.version.constraint.map((c) => {
    if (c.operator !== "~=")
      return c;
    const parts = c.version.split(".");
    if (parts.length === 2) {
      return { operator: "==", version: c.version, prefix: ".*" };
    }
    return c;
  });
  return {
    ...req,
    version: { ...req.version, constraint: newConstraints }
  };
}
function pythonVersionToString(version) {
  let str = `${version.major}.${version.minor}`;
  if (version.patch !== void 0) {
    str += `.${version.patch}`;
  }
  if (version.prerelease) {
    str += version.prerelease;
  }
  return str;
}
function pep440ConstraintsToString(constraints) {
  return constraints.map((c) => `${c.operator}${c.version}${c.prefix ?? ""}`).join(",");
}
function implementationsMatch(buildImpl, requestImpl) {
  if (PythonImplementation.isUnknown(buildImpl)) {
    if (PythonImplementation.isUnknown(requestImpl)) {
      return buildImpl.implementation === requestImpl.implementation;
    }
    return false;
  }
  if (PythonImplementation.isUnknown(requestImpl)) {
    return false;
  }
  return buildImpl === requestImpl;
}
function variantsMatch(buildVariant, requestVariant) {
  if (typeof buildVariant === "object" && "type" in buildVariant) {
    if (typeof requestVariant === "object" && "type" in requestVariant) {
      return buildVariant.variant === requestVariant.variant;
    }
    return false;
  }
  if (typeof requestVariant === "object" && "type" in requestVariant) {
    return false;
  }
  return buildVariant === requestVariant;
}
function buildMatchesRequest(build, request) {
  if (request.implementation !== void 0) {
    if (!implementationsMatch(build.implementation, request.implementation)) {
      return false;
    }
  }
  if (request.version !== void 0) {
    const versionConstraints = request.version.constraint;
    if (versionConstraints.length > 0) {
      const buildVersionStr = pythonVersionToString(build.version);
      const specifier = pep440ConstraintsToString(versionConstraints);
      if (!(0, import_specifier.satisfies)(buildVersionStr, specifier)) {
        return false;
      }
    }
    if (request.version.variant !== void 0) {
      if (!variantsMatch(build.variant, request.version.variant)) {
        return false;
      }
    }
  }
  if (request.platform !== void 0) {
    const platform = request.platform;
    if (platform.os !== void 0) {
      if (build.os.toLowerCase() !== platform.os.toLowerCase()) {
        return false;
      }
    }
    if (platform.arch !== void 0) {
      if (build.architecture.toLowerCase() !== platform.arch.toLowerCase()) {
        return false;
      }
    }
    if (platform.libc !== void 0) {
      if (build.libc.toLowerCase() !== platform.libc.toLowerCase()) {
        return false;
      }
    }
  }
  return true;
}
function buildMatchesConstraint(build, constraint) {
  if (constraint.request.length === 0) {
    return true;
  }
  for (const request of constraint.request) {
    if (buildMatchesRequest(build, request)) {
      return true;
    }
  }
  return false;
}

// src/manifest/requirement/schema.ts
var DependencySourceSchema = dependencySourceSchema.passthrough();
var NormalizedRequirementSchema = normalizedRequirementSchema;
var HashDigestSchema = hashDigestSchema;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DependencySourceSchema,
  HashDigestSchema,
  LicenseObjectSchema,
  LicenseSchema,
  NormalizedRequirementSchema,
  PersonSchema,
  PipfileDependencyDetailSchema,
  PipfileDependencySchema,
  PipfileLikeSchema,
  PipfileLockLikeSchema,
  PipfileLockMetaSchema,
  PipfileSourceSchema,
  PyProjectBuildSystemSchema,
  PyProjectDependencyGroupsSchema,
  PyProjectProjectSchema,
  PyProjectTomlSchema,
  PyProjectToolSectionSchema,
  PythonAnalysisError,
  PythonBuild,
  PythonConfigKind,
  PythonImplementation,
  PythonLockFileKind,
  PythonManifestConvertedKind,
  PythonManifestKind,
  PythonVariant,
  PythonVersion,
  ReadmeObjectSchema,
  ReadmeSchema,
  UvConfigSchema,
  UvConfigWorkspaceSchema,
  UvIndexEntrySchema,
  classifyPackages,
  containsTopLevelCallable,
  createMinimalManifest,
  discoverPythonPackage,
  evaluateMarker,
  extendDistRecord,
  findAppOrHandler,
  getStringConstant,
  isPrivatePackageSource,
  isWheelCompatible,
  normalizePackageName,
  parsePep508,
  parseUvLock,
  scanDistributions,
  selectPython,
  selectPythonVersion,
  stringifyManifest
});
