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
var get_lambda_preload_scripts_exports = {};
__export(get_lambda_preload_scripts_exports, {
  getLambdaPreloadScripts: () => getLambdaPreloadScripts
});
module.exports = __toCommonJS(get_lambda_preload_scripts_exports);
function getLambdaPreloadScripts(lambda, buffer, options) {
  const scripts = [];
  if (lambda.shouldAddSourcemapSupport) {
    scripts.push("/opt/rust/source-map-support.js");
  }
  const BYTECODE_MIN_SIZE_BYTES = (Number.parseInt(options.bytecodeCachingThreshold || "", 10) || 400) * 1024;
  if (options.vercelEnv === "production" && options.useBytecodeCaching === "1" && ["nodejs20.x", "nodejs22.x", "nodejs24.x"].includes(lambda.runtime) && buffer.byteLength >= BYTECODE_MIN_SIZE_BYTES) {
    scripts.push(
      ["nodejs22.x", "nodejs24.x"].includes(lambda.runtime) && options.useNativeBytecodeCaching === "1" ? "/opt/rust/bytecode-native.js" : "/opt/rust/bytecode.js"
    );
  }
  if (lambda.framework?.slug === "nextjs") {
    scripts.push("/opt/rust/next-data.js");
  }
  return scripts;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getLambdaPreloadScripts
});
