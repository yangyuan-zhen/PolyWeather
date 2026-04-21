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
var collect_uncompressed_size_exports = {};
__export(collect_uncompressed_size_exports, {
  collectUncompressedSize: () => collectUncompressedSize
});
module.exports = __toCommonJS(collect_uncompressed_size_exports);
var import_promises = require("fs/promises");
const fileSizeCache = /* @__PURE__ */ new Map();
const getFileSize = (path) => {
  if (!path)
    return Promise.resolve(0);
  const cached = fileSizeCache.get(path);
  if (cached) {
    return cached;
  }
  const promise = (0, import_promises.lstat)(path).then((stats) => stats.size);
  fileSizeCache.set(path, promise);
  return promise;
};
const collectUncompressedSize = async (files, ignoreFn) => {
  let size = 0;
  await Promise.all(
    Object.keys(files).map(async (fileKey) => {
      if (ignoreFn?.(fileKey)) {
        return;
      }
      const file = files[fileKey];
      if (file.type === "FileBlob") {
        size += file.data.length;
      } else if (file.type === "FileFsRef") {
        const fsRef = file;
        const curSize = fsRef.size ?? await getFileSize(fsRef.fsPath);
        size += curSize;
      }
    })
  );
  return size;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  collectUncompressedSize
});
