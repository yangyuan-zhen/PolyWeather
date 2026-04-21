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
var finalize_lambda_exports = {};
__export(finalize_lambda_exports, {
  finalizeLambda: () => finalizeLambda
});
module.exports = __toCommonJS(finalize_lambda_exports);
var import_get_encrypted_env_file = require("./process-serverless/get-encrypted-env-file");
var import_get_lambda_environment = require("./process-serverless/get-lambda-environment");
var import_get_lambda_supports_streaming = require("./process-serverless/get-lambda-supports-streaming");
var import_stream_to_digest_async = require("./fs/stream-to-digest-async");
var import_collect_uncompressed_size = require("./collect-uncompressed-size");
const defaultTrace = (_name, fn) => fn();
async function finalizeLambda(params) {
  const {
    lambda,
    encryptedEnvFilename,
    encryptedEnvContent,
    bytecodeCachingOptions,
    forceStreamingRuntime,
    enableUncompressedLambdaSizeCheck,
    trace = defaultTrace,
    createZip: createZipOverride,
    validateZip
  } = params;
  const encryptedEnv = (0, import_get_encrypted_env_file.getEncryptedEnv)(
    encryptedEnvFilename,
    encryptedEnvContent
  );
  if (encryptedEnv) {
    const [envFilename, envFile] = encryptedEnv;
    lambda.zipBuffer = void 0;
    lambda.files = {
      ...lambda.files,
      [envFilename]: envFile
    };
  }
  let uncompressedBytes = 0;
  if (enableUncompressedLambdaSizeCheck) {
    if (lambda.files) {
      uncompressedBytes = await trace(
        "collectUncompressedSize",
        () => (0, import_collect_uncompressed_size.collectUncompressedSize)(lambda.files ?? {})
      );
    }
  }
  const zipTags = {
    fileCount: String(Object.keys(lambda.files ?? {}).length),
    uncompressedBytes: String(uncompressedBytes)
  };
  let zipResult;
  if (createZipOverride) {
    zipResult = await trace(
      "createZip",
      () => createZipOverride(lambda),
      zipTags
    );
  } else {
    const buffer = lambda.zipBuffer || await trace("createZip", () => lambda.createZip(), zipTags);
    zipResult = {
      buffer,
      digest: "",
      // computed in step 5
      size: buffer.byteLength
    };
  }
  if (validateZip) {
    validateZip({
      buffer: zipResult.buffer,
      zipPath: zipResult.zipPath,
      size: zipResult.size
    });
  }
  if (!createZipOverride && zipResult.buffer) {
    zipResult.digest = (0, import_stream_to_digest_async.sha256)(zipResult.buffer);
  }
  lambda.environment = {
    ...lambda.environment,
    ...(0, import_get_lambda_environment.getLambdaEnvironment)(
      lambda,
      zipResult.buffer ?? { byteLength: zipResult.size },
      bytecodeCachingOptions
    )
  };
  const streamingResult = await (0, import_get_lambda_supports_streaming.getLambdaSupportsStreaming)(
    lambda,
    forceStreamingRuntime
  );
  lambda.supportsResponseStreaming = streamingResult.supportsStreaming;
  return {
    buffer: zipResult.buffer,
    zipPath: zipResult.zipPath ?? null,
    digest: zipResult.digest,
    size: zipResult.size,
    uncompressedBytes,
    streamingError: streamingResult.error
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  finalizeLambda
});
