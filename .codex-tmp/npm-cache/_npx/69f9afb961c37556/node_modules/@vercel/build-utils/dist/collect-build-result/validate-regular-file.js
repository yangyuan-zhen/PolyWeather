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
var validate_regular_file_exports = {};
__export(validate_regular_file_exports, {
  validateRegularFile: () => validateRegularFile
});
module.exports = __toCommonJS(validate_regular_file_exports);
var import_errors = require("../errors");
var import_fs_extra = require("fs-extra");
async function validateRegularFile(file) {
  if ("fsPath" in file && typeof file.fsPath === "string") {
    const stat = await (0, import_fs_extra.lstat)(file.fsPath);
    if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new import_errors.NowBuildError({
        message: `Output file path is actually not a (regular) file: \`${file.fsPath}\``,
        code: "OUTPUT_FILE_IS_NOT_REGULAR_FILE"
      });
    }
    return stat;
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  validateRegularFile
});
