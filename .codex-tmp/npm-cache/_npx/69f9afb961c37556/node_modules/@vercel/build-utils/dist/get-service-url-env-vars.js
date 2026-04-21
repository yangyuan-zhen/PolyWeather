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
var get_service_url_env_vars_exports = {};
__export(get_service_url_env_vars_exports, {
  getServiceUrlEnvVars: () => getServiceUrlEnvVars
});
module.exports = __toCommonJS(get_service_url_env_vars_exports);
function serviceNameToEnvVar(name) {
  return `${name.replace(/-/g, "_").toUpperCase()}_URL`;
}
function computeServiceUrl(baseUrl, routePrefix, isOrigin) {
  if (!isOrigin) {
    baseUrl = `https://${baseUrl}`;
  }
  if (routePrefix === "/") {
    return baseUrl;
  }
  const normalizedPrefix = routePrefix.startsWith("/") ? routePrefix.slice(1) : routePrefix;
  return `${baseUrl}/${normalizedPrefix}`;
}
function getFrameworkEnvPrefix(frameworkSlug, frameworkList) {
  if (!frameworkSlug)
    return void 0;
  const framework = frameworkList.find(
    (f) => f.slug !== null && f.slug === frameworkSlug
  );
  return framework?.envPrefix;
}
function getServiceUrlEnvVars(options) {
  const {
    services,
    frameworkList,
    currentEnv = {},
    deploymentUrl,
    origin,
    envPrefix
  } = options;
  const baseUrl = origin || deploymentUrl;
  if (!baseUrl || !services || services.length === 0) {
    return {};
  }
  const envVars = {};
  const frameworkPrefixes = /* @__PURE__ */ new Set();
  for (const service of services) {
    const prefix = getFrameworkEnvPrefix(service.framework, frameworkList);
    if (prefix) {
      frameworkPrefixes.add(prefix);
    }
  }
  for (const service of services) {
    if (service.type !== "web" || !service.routePrefix) {
      continue;
    }
    const baseEnvVarName = serviceNameToEnvVar(service.name);
    const absoluteUrl = computeServiceUrl(
      baseUrl,
      service.routePrefix,
      !!origin
    );
    const effectiveBaseEnvVarName = envPrefix ? `${envPrefix}${baseEnvVarName}` : baseEnvVarName;
    if (!(effectiveBaseEnvVarName in currentEnv)) {
      envVars[effectiveBaseEnvVarName] = absoluteUrl;
    }
    for (const prefix of frameworkPrefixes) {
      const prefixedEnvVarName = envPrefix ? `${prefix}${envPrefix}${baseEnvVarName}` : `${prefix}${baseEnvVarName}`;
      if (!(prefixedEnvVarName in currentEnv)) {
        envVars[prefixedEnvVarName] = service.routePrefix;
      }
    }
  }
  return envVars;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getServiceUrlEnvVars
});
