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
var get_lambda_supports_streaming_exports = {};
__export(get_lambda_supports_streaming_exports, {
  getLambdaSupportsStreaming: () => getLambdaSupportsStreaming
});
module.exports = __toCommonJS(get_lambda_supports_streaming_exports);
async function getLambdaSupportsStreaming(lambda, forceStreamingRuntime) {
  if (forceStreamingRuntime) {
    return { supportsStreaming: true };
  }
  if (typeof lambda.supportsResponseStreaming === "boolean") {
    return { supportsStreaming: lambda.supportsResponseStreaming };
  }
  if ("launcherType" in lambda && lambda.launcherType === "Nodejs") {
    return { supportsStreaming: true };
  }
  return { supportsStreaming: void 0 };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getLambdaSupportsStreaming
});
