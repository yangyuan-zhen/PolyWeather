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
var get_lambda_environment_exports = {};
__export(get_lambda_environment_exports, {
  getLambdaEnvironment: () => getLambdaEnvironment
});
module.exports = __toCommonJS(get_lambda_environment_exports);
var import_get_lambda_preload_scripts = require("./get-lambda-preload-scripts");
function getLambdaEnvironment(lambda, buffer, options) {
  const environment = {};
  if ("launcherType" in lambda && lambda.launcherType === "Nodejs") {
    if (lambda.awsLambdaHandler) {
      environment.AWS_LAMBDA_HANDLER = lambda.awsLambdaHandler;
    }
    if (lambda.shouldAddHelpers) {
      environment.VERCEL_SHOULD_ADD_HELPERS = "1";
    }
    if (lambda.useWebApi === true) {
      environment.VERCEL_USE_WEB_API = "1";
    }
    if (lambda.shouldAddSourcemapSupport) {
      environment.VERCEL_SOURCE_MAP = "1";
    }
    if (lambda.shouldDisableAutomaticFetchInstrumentation) {
      environment.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION = "1";
    }
    const scripts = (0, import_get_lambda_preload_scripts.getLambdaPreloadScripts)(lambda, buffer, options);
    if (scripts.length > 0) {
      environment.VERCEL_NODE_PRELOAD_SCRIPTS = scripts.join(",");
    }
  }
  return environment;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getLambdaEnvironment
});
