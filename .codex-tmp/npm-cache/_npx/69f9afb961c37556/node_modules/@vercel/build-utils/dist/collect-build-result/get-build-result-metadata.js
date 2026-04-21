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
var get_build_result_metadata_exports = {};
__export(get_build_result_metadata_exports, {
  getBuildResultMetadata: () => getBuildResultMetadata
});
module.exports = __toCommonJS(get_build_result_metadata_exports);
var import_errors = require("../errors");
var import_get_lambda_by_output_path = require("./get-lambda-by-output-path");
var import_get_prerender_chain = require("./get-prerender-chain");
var import_is_route_middleware = require("./is-route-middleware");
function getBuildResultMetadata(params) {
  return {
    middleware: getMiddlewareMetadata(params),
    ppr: new Map(
      Object.entries(params.buildOutputMap).flatMap(([_outputPath, output]) => {
        if (output.type === "Prerender") {
          const chain = (0, import_get_prerender_chain.getPrerenderChain)(output);
          if (chain) {
            const maybeLambda = (0, import_get_lambda_by_output_path.getLambdaByOutputPath)({
              buildOutputMap: params.buildOutputMap,
              outputPath: chain.outputPath
            });
            if (maybeLambda) {
              return [[chain.outputPath, true]];
            }
          }
        }
        return [];
      })
    )
  };
}
function getMiddlewareMetadata(params) {
  const deduped = new Map(
    params.routes.filter(import_is_route_middleware.isRouteMiddleware).map(
      (route) => toMiddlewareTuple({
        buildOutputMap: params.buildOutputMap,
        middlewarePath: route.middlewarePath
      })
    )
  );
  return new Map(
    Array.from(deduped, ([outputPath, metadata], index) => [
      outputPath,
      { ...metadata, index }
    ])
  );
}
function toMiddlewareTuple(params) {
  const keys = [
    params.middlewarePath,
    params.middlewarePath.replace(/^\//, "")
  ];
  const [outputPath, output] = Object.entries(params.buildOutputMap).find(
    (entry) => keys.includes(entry[0]) && (entry[1].type === "EdgeFunction" || entry[1].type === "Lambda")
  ) ?? [];
  if (!outputPath || !output) {
    throw new import_errors.NowBuildError({
      message: `Mapping ${params.middlewarePath} not found. Maybe you provided a wrong middlewarePath?`,
      code: "middleware_path_not_found"
    });
  }
  return [
    outputPath,
    output.type === "EdgeFunction" ? {
      edgeFunction: output,
      match: new Set(keys),
      middlewarePath: params.middlewarePath,
      outputPath,
      type: "middleware"
    } : {
      match: new Set(keys),
      middlewarePath: params.middlewarePath,
      outputPath,
      type: "middleware-lambda"
    }
  ];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getBuildResultMetadata
});
