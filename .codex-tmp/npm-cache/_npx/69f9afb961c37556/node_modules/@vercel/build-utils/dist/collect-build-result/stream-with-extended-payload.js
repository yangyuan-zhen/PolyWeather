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
var stream_with_extended_payload_exports = {};
__export(stream_with_extended_payload_exports, {
  streamWithExtendedPayload: () => streamWithExtendedPayload
});
module.exports = __toCommonJS(stream_with_extended_payload_exports);
var import_stream = require("stream");
function streamWithExtendedPayload(stream, data) {
  return data ? new MultipartContentStream(stream, data) : stream;
}
class MultipartContentStream extends import_stream.Readable {
  constructor(stream, data) {
    super();
    stream.on("error", (err) => {
      this.emit("error", err);
    });
    stream.on("end", () => {
      this.push(data.suffix);
      this.push(null);
    });
    this.push(data.prefix);
    stream.on("data", (chunk) => {
      this.push(chunk);
    });
  }
  _read() {
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  streamWithExtendedPayload
});
