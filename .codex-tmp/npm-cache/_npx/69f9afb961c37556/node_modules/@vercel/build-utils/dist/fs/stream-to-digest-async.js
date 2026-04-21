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
var stream_to_digest_async_exports = {};
__export(stream_to_digest_async_exports, {
  md5: () => md5,
  sha256: () => sha256,
  streamToDigestAsync: () => streamToDigestAsync
});
module.exports = __toCommonJS(stream_to_digest_async_exports);
var import_crypto = require("crypto");
async function streamToDigestAsync(stream) {
  return await new Promise((resolve, reject) => {
    stream.once("error", reject);
    let count = 0;
    const sha2562 = (0, import_crypto.createHash)("sha256");
    const md52 = (0, import_crypto.createHash)("md5");
    stream.on("end", () => {
      const res = {
        sha256: sha2562.digest("hex"),
        md5: md52.digest("hex"),
        size: count
      };
      resolve(res);
    });
    stream.on("readable", () => {
      let chunk;
      while (null !== (chunk = stream.read())) {
        md52.update(chunk);
        sha2562.update(chunk);
        count += chunk.length;
      }
    });
  });
}
function sha256(value) {
  return (0, import_crypto.createHash)("sha256").update(value).digest("hex");
}
function md5(value) {
  return (0, import_crypto.createHash)("md5").update(value).digest("hex");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  md5,
  sha256,
  streamToDigestAsync
});
