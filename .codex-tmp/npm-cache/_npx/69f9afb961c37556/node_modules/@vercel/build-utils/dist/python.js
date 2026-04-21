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
var python_exports = {};
__export(python_exports, {
  isPythonEntrypoint: () => isPythonEntrypoint
});
module.exports = __toCommonJS(python_exports);
var import_fs = __toESM(require("fs"));
var import_python_analysis = require("@vercel/python-analysis");
var import_debug = __toESM(require("./debug"));
async function isPythonEntrypoint(file) {
  try {
    const fsPath = file.fsPath;
    if (!fsPath)
      return false;
    const content = await import_fs.default.promises.readFile(fsPath, "utf-8");
    return await (0, import_python_analysis.findAppOrHandler)(content) !== null;
  } catch (err) {
    (0, import_debug.default)(`Failed to check Python entrypoint: ${err}`);
    return false;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isPythonEntrypoint
});
