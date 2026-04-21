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
var file_to_build_output_file_exports = {};
__export(file_to_build_output_file_exports, {
  fileToBuildOutputFile: () => fileToBuildOutputFile
});
module.exports = __toCommonJS(file_to_build_output_file_exports);
var import_stream_to_digest_async = require("../fs/stream-to-digest-async");
var import_stream_with_extended_payload = require("./stream-with-extended-payload");
var import_validate_regular_file = require("./validate-regular-file");
var import_get_content_type = require("./get-content-type");
async function fileToBuildOutputFile(params) {
  await (0, import_validate_regular_file.validateRegularFile)(params.buildResult);
  const digest = await (0, import_stream_to_digest_async.streamToDigestAsync)(
    (0, import_stream_with_extended_payload.streamWithExtendedPayload)(
      params.buildResult.toStreamAsync ? await params.buildResult.toStreamAsync() : params.buildResult.toStream(),
      params.extendedBody
    )
  );
  const contentType = params.buildResult.contentType ? params.buildResult.contentType : "fsPath" in params.buildResult ? (0, import_get_content_type.getContentType)(params.buildResult.fsPath) : void 0;
  return {
    digest,
    output: {
      type: "file",
      path: params.outputPath,
      prerenderPath: params.buildResult.prerenderPath,
      digest: digest.sha256,
      mode: params.buildResult.mode,
      contentType,
      size: digest.size,
      lambda: null
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fileToBuildOutputFile
});
