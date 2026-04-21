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
var get_lambda_by_output_path_exports = {};
__export(get_lambda_by_output_path_exports, {
  getLambdaByOutputPath: () => getLambdaByOutputPath
});
module.exports = __toCommonJS(get_lambda_by_output_path_exports);
function getLambdaByOutputPath(params) {
  const output = params.buildOutputMap[params.outputPath];
  return output?.type === "Lambda" ? output : output?.type === "Prerender" ? output.lambda : void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getLambdaByOutputPath
});
