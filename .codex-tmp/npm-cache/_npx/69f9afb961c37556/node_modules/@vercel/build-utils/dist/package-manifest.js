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
var package_manifest_exports = {};
__export(package_manifest_exports, {
  MANIFEST_FILENAME: () => MANIFEST_FILENAME,
  MANIFEST_VERSION: () => MANIFEST_VERSION,
  createDiagnostics: () => createDiagnostics,
  manifestPath: () => manifestPath,
  writeProjectManifest: () => writeProjectManifest
});
module.exports = __toCommonJS(package_manifest_exports);
var import_fs = __toESM(require("fs"));
var import_path = require("path");
var import_file_blob = __toESM(require("./file-blob"));
const MANIFEST_VERSION = "20260304";
const MANIFEST_FILENAME = "package-manifest.json";
function manifestPath(runtime) {
  return (0, import_path.join)(".vercel", runtime, MANIFEST_FILENAME);
}
async function writeProjectManifest(manifest, workPath, runtime) {
  const outPath = (0, import_path.join)(workPath, manifestPath(runtime));
  await import_fs.default.promises.mkdir((0, import_path.dirname)(outPath), { recursive: true });
  await import_fs.default.promises.writeFile(outPath, JSON.stringify(manifest, null, 2));
}
function createDiagnostics(runtime) {
  return async ({ workPath }) => {
    try {
      const filePath = (0, import_path.join)(workPath, manifestPath(runtime));
      const data = await import_fs.default.promises.readFile(filePath, "utf-8");
      return {
        [MANIFEST_FILENAME]: new import_file_blob.default({ data })
      };
    } catch {
      return {};
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  createDiagnostics,
  manifestPath,
  writeProjectManifest
});
