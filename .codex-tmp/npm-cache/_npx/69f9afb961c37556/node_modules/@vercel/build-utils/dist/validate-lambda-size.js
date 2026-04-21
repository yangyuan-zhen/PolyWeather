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
var validate_lambda_size_exports = {};
__export(validate_lambda_size_exports, {
  ENV_WRAPPER_SUPPORTED_FAMILIES: () => ENV_WRAPPER_SUPPORTED_FAMILIES,
  FunctionSizeError: () => FunctionSizeError,
  MAX_LAMBDA_SIZE: () => MAX_LAMBDA_SIZE,
  MAX_LAMBDA_UNCOMPRESSED_SIZE: () => MAX_LAMBDA_UNCOMPRESSED_SIZE,
  validateEnvWrapperSupport: () => validateEnvWrapperSupport,
  validateLambdaSize: () => validateLambdaSize,
  validateUncompressedLambdaSize: () => validateUncompressedLambdaSize
});
module.exports = __toCommonJS(validate_lambda_size_exports);
var import_errors = require("./errors");
var import_bytes = __toESM(require("bytes"));
const MAX_LAMBDA_SIZE = (0, import_bytes.default)("300mb");
const MAX_LAMBDA_UNCOMPRESSED_SIZE = 250 * 1024 * 1024;
class FunctionSizeError extends import_errors.NowBuildError {
  constructor(outputPath, size) {
    super({
      code: "NOW_SANDBOX_WORKER_MAX_LAMBDA_SIZE",
      message: `The Vercel Function "${outputPath}" is ${(0, import_bytes.default)(
        size
      ).toLowerCase()} which exceeds the maximum size limit of ${(0, import_bytes.default)(
        MAX_LAMBDA_SIZE
      ).toLowerCase()}.`,
      link: "https://vercel.link/serverless-function-size",
      action: "Learn More"
    });
    this.size = size;
    this.maxSize = MAX_LAMBDA_SIZE;
  }
}
function validateLambdaSize(outputPath, runtime, size) {
  if (runtime.startsWith("python")) {
    return;
  }
  if (size > MAX_LAMBDA_SIZE) {
    throw new FunctionSizeError(outputPath, size);
  }
}
function validateUncompressedLambdaSize(outputPath, uncompressedBytes) {
  if (uncompressedBytes >= MAX_LAMBDA_UNCOMPRESSED_SIZE) {
    throw new import_errors.NowBuildError({
      code: "NOW_SANDBOX_WORKER_MAX_UNCOMPRESSED_LAMBDA_SIZE",
      message: `The Vercel Function "${outputPath}" is ${(0, import_bytes.default)(
        uncompressedBytes
      ).toLowerCase()} uncompressed which exceeds the maximum uncompressed size limit of ${(0, import_bytes.default)(
        MAX_LAMBDA_UNCOMPRESSED_SIZE
      ).toLowerCase()}.`,
      link: "https://vercel.link/serverless-function-size",
      action: "Learn More"
    });
  }
}
const ENV_WRAPPER_SUPPORTED_FAMILIES = [
  "nodejs",
  "python",
  "ruby",
  "java",
  "dotnetcore",
  "bun",
  "executable"
];
function validateEnvWrapperSupport(encryptedEnvFilename, encryptedEnvContent, lambda) {
  if (!encryptedEnvFilename || !encryptedEnvContent) {
    return;
  }
  if (!lambda.supportsWrapper && !ENV_WRAPPER_SUPPORTED_FAMILIES.some(
    (family) => lambda.runtime.startsWith(family)
  )) {
    throw new Error(
      `Serverless Function runtime ${lambda.runtime} does not support more than 4KB for environment variables`
    );
  }
  if (typeof lambda.createZip !== "function") {
    throw new Error(
      `Serverless Function with runtime ${lambda.runtime} has no createZip function`
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ENV_WRAPPER_SUPPORTED_FAMILIES,
  FunctionSizeError,
  MAX_LAMBDA_SIZE,
  MAX_LAMBDA_UNCOMPRESSED_SIZE,
  validateEnvWrapperSupport,
  validateLambdaSize,
  validateUncompressedLambdaSize
});
