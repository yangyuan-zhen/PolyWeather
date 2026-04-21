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
var service_path_utils_exports = {};
__export(service_path_utils_exports, {
  INTERNAL_SERVICE_PREFIX: () => INTERNAL_SERVICE_PREFIX,
  getInternalServiceCronPath: () => getInternalServiceCronPath,
  getInternalServiceCronPathPrefix: () => getInternalServiceCronPathPrefix,
  getInternalServiceFunctionPath: () => getInternalServiceFunctionPath
});
module.exports = __toCommonJS(service_path_utils_exports);
const INTERNAL_SERVICE_PREFIX = "/_svc";
function normalizeInternalServiceEntrypoint(entrypoint) {
  const normalized = entrypoint.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.[^/.]+$/, "");
  return normalized || "index";
}
function getInternalServiceFunctionPath(serviceName) {
  return `${INTERNAL_SERVICE_PREFIX}/${serviceName}/index`;
}
function getInternalServiceCronPathPrefix(serviceName) {
  return `${INTERNAL_SERVICE_PREFIX}/${serviceName}/crons`;
}
function getInternalServiceCronPath(serviceName, entrypoint, handler = "cron") {
  const normalizedEntrypoint = normalizeInternalServiceEntrypoint(entrypoint);
  return `${getInternalServiceCronPathPrefix(serviceName)}/${normalizedEntrypoint}/${handler}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  INTERNAL_SERVICE_PREFIX,
  getInternalServiceCronPath,
  getInternalServiceCronPathPrefix,
  getInternalServiceFunctionPath
});
