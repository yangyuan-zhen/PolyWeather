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
var node_entrypoint_exports = {};
__export(node_entrypoint_exports, {
  isNodeEntrypoint: () => isNodeEntrypoint
});
module.exports = __toCommonJS(node_entrypoint_exports);
var import_fs = __toESM(require("fs"));
var import_debug = __toESM(require("./debug"));
const HTTP_METHODS = "GET|HEAD|OPTIONS|POST|PUT|DELETE|PATCH";
const VALID_EXPORT_PATTERNS = [
  // ESM default export: export default function handler() {}
  /export\s+default\b/,
  // CJS default export: module.exports = (req, res) => {}
  /module\.exports\s*=/,
  // ESM named HTTP method or fetch exports: export function GET() {}
  new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+(?:${HTTP_METHODS}|fetch)\\b`
  ),
  // ESM re-exports: export { GET } or export { handler as default }
  new RegExp(`export\\s*\\{[^}]*\\b(?:${HTTP_METHODS}|fetch|default)\\b`),
  // CJS named exports: exports.GET = ... or module.exports.GET = ...
  new RegExp(`(?:module\\.)?exports\\.(?:${HTTP_METHODS}|fetch|default)\\s*=`),
  // Server handler: http.createServer(...).listen() with no exports
  /http\.createServer\s*\(/
];
function stripComments(content) {
  return content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
async function isNodeEntrypoint(file) {
  try {
    const fsPath = file.fsPath;
    if (!fsPath)
      return true;
    const content = await import_fs.default.promises.readFile(fsPath, "utf-8");
    if (!content.trim())
      return false;
    const stripped = stripComments(content);
    return VALID_EXPORT_PATTERNS.some((pattern) => pattern.test(stripped));
  } catch (err) {
    (0, import_debug.default)(`Failed to check Node.js entrypoint: ${err}`);
    return true;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isNodeEntrypoint
});
