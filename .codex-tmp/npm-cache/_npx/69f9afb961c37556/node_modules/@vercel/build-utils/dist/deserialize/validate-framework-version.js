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
var validate_framework_version_exports = {};
__export(validate_framework_version_exports, {
  validateFrameworkVersion: () => validateFrameworkVersion
});
module.exports = __toCommonJS(validate_framework_version_exports);
var import_errors = require("../errors");
const MAX_FRAMEWORK_VERSION_LENGTH = 50;
function validateFrameworkVersion(frameworkVersion) {
  if (!frameworkVersion) {
    return void 0;
  }
  if (typeof frameworkVersion !== "string") {
    throw new import_errors.NowBuildError({
      message: `Invalid config.json: "framework.version" type "${typeof frameworkVersion}" should be "string"`,
      code: "VC_BUILD_INVALID_CONFIG_JSON_FRAMEWORK_VERSION_TYPE"
    });
  }
  if (frameworkVersion.length > MAX_FRAMEWORK_VERSION_LENGTH) {
    const trimmedFrameworkVersion = frameworkVersion.slice(
      0,
      MAX_FRAMEWORK_VERSION_LENGTH
    );
    throw new import_errors.NowBuildError({
      message: `Invalid config.json: "framework.version" length ${frameworkVersion.length} > ${MAX_FRAMEWORK_VERSION_LENGTH}. "${trimmedFrameworkVersion}..."`,
      code: "VC_BUILD_INVALID_CONFIG_JSON_FRAMEWORK_VERSION_LENGTH"
    });
  }
  return {
    version: frameworkVersion
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  validateFrameworkVersion
});
