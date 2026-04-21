"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var create_functions_iterator_exports = {};
__export(create_functions_iterator_exports, {
  createFunctionsIterator: () => createFunctionsIterator
});
module.exports = __toCommonJS(create_functions_iterator_exports);
var import_path = require("path");
var import_fs_extra = require("fs-extra");
const SUFFIX = ".func";
async function* createFunctionsIterator(dir, root = dir) {
  let paths;
  try {
    paths = await (0, import_fs_extra.readdir)(dir);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      throw err;
    }
    paths = [];
  }
  for (const path of paths) {
    const abs = (0, import_path.join)(dir, path);
    const s = await (0, import_fs_extra.stat)(abs);
    if (s.isDirectory()) {
      if (path.endsWith(SUFFIX)) {
        yield (0, import_path.relative)(root, abs.substring(0, abs.length - SUFFIX.length));
      } else {
        yield* createFunctionsIterator(abs, root);
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFunctionsIterator
});
