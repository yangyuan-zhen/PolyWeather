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
var validate_build_result_exports = {};
__export(validate_build_result_exports, {
  SUPPORTED_AL2023_RUNTIMES: () => SUPPORTED_AL2023_RUNTIMES,
  validateBuildResult: () => validateBuildResult
});
module.exports = __toCommonJS(validate_build_result_exports);
var import_minimatch = __toESM(require("minimatch"));
var import_errors = require("../errors");
const SUPPORTED_AL2023_RUNTIMES = [
  "nodejs20.x",
  "nodejs22.x",
  "nodejs24.x",
  "provided.al2023",
  "python3.12",
  "python3.13",
  "python3.14",
  "ruby3.3",
  "bun1.x",
  "executable"
];
const DEFAULT_ENTRYPOINT = ".";
const DEVELOPING_A_RUNTIME_URL = "https://github.com/vercel/vercel/blob/master/DEVELOPING_A_RUNTIME.md";
function isSupportedAl2023Runtime(runtime) {
  return SUPPORTED_AL2023_RUNTIMES.some((supported) => supported === runtime);
}
async function validateBuildResult({
  allowInvalidRuntime = false,
  buildConfig,
  buildResponse,
  osRelease,
  vercelBaseUrl
}) {
  if (!("output" in buildResponse)) {
    throw new import_errors.NowBuildError({
      code: "NOW_SANDBOX_WORKER_BUILDER_ERROR",
      message: 'The result of "builder.build" must include an `output` property for "@vercel/vc-build".'
    });
  }
  if (!buildResponse.output || typeof buildResponse.output !== "object") {
    throw new import_errors.NowBuildError({
      code: "NOW_SANDBOX_WORKER_BUILDER_ERROR",
      message: 'The result of "builder.build" must be an object'
    });
  }
  const buildOutputMap = getAndVerifyOutputLambdasOrEdgeFuncs(buildResponse);
  if (osRelease?.VERSION === "2023") {
    const invalidRuntimes = [];
    for (const [name, entry] of Object.entries(buildOutputMap)) {
      let lambda;
      if (entry.type === "Prerender") {
        lambda = entry.lambda;
      } else if (entry.type === "Lambda") {
        lambda = entry;
      }
      if (!lambda)
        continue;
      if (!isSupportedAl2023Runtime(lambda.runtime)) {
        invalidRuntimes.push({ name, lambda });
      }
    }
    if (invalidRuntimes.length > 0 && !allowInvalidRuntime) {
      throw new import_errors.NowBuildError({
        code: "NOW_SANDBOX_WORKER_INVALID_RUNTIME",
        message: `The following Serverless Functions contain an invalid "runtime":
${invalidRuntimes.map(({ name, lambda }) => `  - ${name} (${lambda.runtime})`).join("\n")}`,
        link: getVercelUrl(
          "/docs/functions/runtimes#official-runtimes",
          vercelBaseUrl
        )
      });
    }
  }
  const customFunctionConfiguration = getCustomFunctionConfigMaybe(buildConfig);
  if (customFunctionConfiguration?.runtime) {
    throw new import_errors.NowBuildError({
      code: "NOW_SANDBOX_WORKER_FUNCTION_RUNTIME_VERSION",
      message: `The Community Runtime ${customFunctionConfiguration.runtime} is not using version 3 of the Runtime API. If you are the Runtime author, see the docs by clicking "View Details" above.`,
      link: DEVELOPING_A_RUNTIME_URL
    });
  }
  return {
    buildOutputMap,
    customFunctionConfiguration
  };
}
function getCustomFunctionConfigMaybe(buildConfig) {
  const functions = buildConfig?.functions ?? buildConfig?.vercelConfig?.functions;
  if (!functions) {
    return;
  }
  for (const [funcPath, config] of Object.entries(functions)) {
    if (funcPath === DEFAULT_ENTRYPOINT || (0, import_minimatch.default)(DEFAULT_ENTRYPOINT, funcPath)) {
      return config;
    }
  }
  return void 0;
}
function getVercelUrl(path, vercelBaseUrl = "https://vercel.com") {
  const url = new URL(path, vercelBaseUrl);
  if (url.pathname === "/") {
    return url.href.slice(0, -1);
  }
  return url.href;
}
function getAndVerifyOutputLambdasOrEdgeFuncs(buildResponse) {
  return buildResponse.output;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SUPPORTED_AL2023_RUNTIMES,
  validateBuildResult
});
