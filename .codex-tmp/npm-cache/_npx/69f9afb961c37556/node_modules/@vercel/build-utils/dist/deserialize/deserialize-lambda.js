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
var deserialize_lambda_exports = {};
__export(deserialize_lambda_exports, {
  deserializeLambda: () => deserializeLambda
});
module.exports = __toCommonJS(deserialize_lambda_exports);
var import_lambda = require("../lambda");
var import_nodejs_lambda = require("../nodejs-lambda");
var import_hydrate_files_map = require("./hydrate-files-map");
async function deserializeLambda(files, config, repoRootPath, fileFsRefsCache, options) {
  const LambdaCtor = options?.LambdaClass ?? import_lambda.Lambda;
  const NodejsLambdaCtor = options?.NodejsLambdaClass ?? import_nodejs_lambda.NodejsLambda;
  if (config.filePathMap) {
    await (0, import_hydrate_files_map.hydrateFilesMap)(
      files,
      config.filePathMap,
      repoRootPath,
      fileFsRefsCache
    );
  }
  const supportsResponseStreaming = config.supportsResponseStreaming ?? config.experimentalResponseStreaming;
  if ("launcherType" in config && config.launcherType === "Nodejs") {
    const overrideResponseStreaming = (options?.useOnlyStreamingLambda || options?.forceNodejsStreaming) && (config.awsLambdaHandler === void 0 || config.awsLambdaHandler === "");
    return new NodejsLambdaCtor({
      ...config,
      supportsResponseStreaming: overrideResponseStreaming || supportsResponseStreaming,
      files
    });
  }
  return new LambdaCtor({
    ...config,
    supportsResponseStreaming,
    files
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deserializeLambda
});
