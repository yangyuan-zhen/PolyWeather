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
var prerender_to_build_output_file_exports = {};
__export(prerender_to_build_output_file_exports, {
  prerenderToBuildOutputFile: () => prerenderToBuildOutputFile
});
module.exports = __toCommonJS(prerender_to_build_output_file_exports);
var import_file_blob = __toESM(require("../file-blob"));
var import_crypto = require("crypto");
var import_file_to_build_output_file = require("./file-to-build-output-file");
async function prerenderToBuildOutputFile(params) {
  const extended = getExtendedPayload(params.buildResult);
  if (!extended.fallback) {
    return null;
  }
  const filePath = params.outputPath + ".fallback";
  const { output, digest } = await (0, import_file_to_build_output_file.fileToBuildOutputFile)({
    outputPath: filePath,
    buildResult: extended.fallback,
    extendedBody: extended.extendedBody
  });
  return {
    file: extended.fallback,
    output,
    digest,
    extended
  };
}
const CRLF = "\r\n";
const MULTIPART_HEADER = "multipart/x-nextjs-extended-payload";
const boundary = (0, import_crypto.randomBytes)(8).toString("hex");
function getExtendedPayload({
  initialHeaders,
  fallback
}) {
  if (!initialHeaders || !Object.entries(initialHeaders).length) {
    return { initialHeaders: void 0, fallback, extendedBody: void 0 };
  }
  return {
    initialHeaders: {
      ...fallback ? {} : { "x-vercel-empty-fallback": "true" },
      "content-type": `${MULTIPART_HEADER}; boundary=${boundary}`
    },
    fallback: fallback ?? new import_file_blob.default({ data: "" }),
    extendedBody: {
      suffix: `${CRLF}${CRLF}--${boundary}--${CRLF}`,
      prefix: [
        `--${boundary}`,
        ...Object.entries(initialHeaders).map(
          ([key, value]) => `${key}: ${value}`
        )
      ].join(CRLF) + CRLF + CRLF
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  prerenderToBuildOutputFile
});
