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
var maybe_read_json_exports = {};
__export(maybe_read_json_exports, {
  maybeReadJSON: () => maybeReadJSON
});
module.exports = __toCommonJS(maybe_read_json_exports);
var import_fs_extra = require("fs-extra");
async function maybeReadJSON(path) {
  try {
    return await (0, import_fs_extra.readJSON)(path);
  } catch (err) {
    if (err.code !== "ENOENT")
      throw err;
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  maybeReadJSON
});
