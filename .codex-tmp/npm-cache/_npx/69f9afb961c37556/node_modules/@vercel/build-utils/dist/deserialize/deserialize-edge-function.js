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
var deserialize_edge_function_exports = {};
__export(deserialize_edge_function_exports, {
  deserializeEdgeFunction: () => deserializeEdgeFunction
});
module.exports = __toCommonJS(deserialize_edge_function_exports);
var import_edge_function = require("../edge-function");
var import_hydrate_files_map = require("./hydrate-files-map");
async function deserializeEdgeFunction(files, config, repoRootPath, fileFsRefsCache) {
  if (config.filePathMap) {
    await (0, import_hydrate_files_map.hydrateFilesMap)(
      files,
      config.filePathMap,
      repoRootPath,
      fileFsRefsCache
    );
  }
  const edgeFunction = new import_edge_function.EdgeFunction({
    // "v8-worker" is currently the only supported target, so specify
    // it implicitly here so that `.vc-config.json` does not need to.
    deploymentTarget: "v8-worker",
    ...config,
    files
  });
  return edgeFunction;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deserializeEdgeFunction
});
