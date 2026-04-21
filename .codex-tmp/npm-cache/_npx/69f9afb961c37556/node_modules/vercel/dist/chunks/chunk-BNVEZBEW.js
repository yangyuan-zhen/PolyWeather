import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  getUpdateCommand
} from "./chunk-SKXUP3WW.js";
import {
  login
} from "./chunk-Y3HAJQCS.js";
import {
  apiCommand,
  listSubcommand2 as listSubcommand,
  loginCommand
} from "./chunk-R4ZPBOD7.js";
import {
  help
} from "./chunk-LDXYSGPZ.js";
import {
  global_path_default
} from "./chunk-U7MQBM3F.js";
import {
  TelemetryClient
} from "./chunk-U3WLEFHU.js";
import {
  require_ms
} from "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError,
  require_strip_ansi
} from "./chunk-RFMC2QXQ.js";
import {
  packageName
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __commonJS,
  __toESM
} from "./chunk-TZ2YI2VH.js";

// ../../node_modules/.pnpm/jaro-winkler@0.2.8/node_modules/jaro-winkler/index.js
var require_jaro_winkler = __commonJS({
  "../../node_modules/.pnpm/jaro-winkler@0.2.8/node_modules/jaro-winkler/index.js"(exports, module) {
    (function(root) {
      "use strict";
      function extend(a, b) {
        for (var property in b) {
          if (b.hasOwnProperty(property)) {
            a[property] = b[property];
          }
        }
        return a;
      }
      function distance2(s1, s2, options) {
        var m = 0;
        var defaults = { caseSensitive: true };
        var settings = extend(defaults, options);
        var i;
        var j;
        if (s1.length === 0 || s2.length === 0) {
          return 0;
        }
        if (!settings.caseSensitive) {
          s1 = s1.toUpperCase();
          s2 = s2.toUpperCase();
        }
        if (s1 === s2) {
          return 1;
        }
        var range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
        var s1Matches = new Array(s1.length);
        var s2Matches = new Array(s2.length);
        for (i = 0; i < s1.length; i++) {
          var low = i >= range ? i - range : 0;
          var high = i + range <= s2.length - 1 ? i + range : s2.length - 1;
          for (j = low; j <= high; j++) {
            if (s1Matches[i] !== true && s2Matches[j] !== true && s1[i] === s2[j]) {
              ++m;
              s1Matches[i] = s2Matches[j] = true;
              break;
            }
          }
        }
        if (m === 0) {
          return 0;
        }
        var k = 0;
        var numTrans = 0;
        for (i = 0; i < s1.length; i++) {
          if (s1Matches[i] === true) {
            for (j = k; j < s2.length; j++) {
              if (s2Matches[j] === true) {
                k = j + 1;
                break;
              }
            }
            if (s1[i] !== s2[j]) {
              ++numTrans;
            }
          }
        }
        var weight = (m / s1.length + m / s2.length + (m - numTrans / 2) / m) / 3;
        var l = 0;
        var p = 0.1;
        if (weight > 0.7) {
          while (s1[l] === s2[l] && l < 4) {
            ++l;
          }
          weight = weight + l * p * (1 - weight);
        }
        return weight;
      }
      if (typeof define === "function" && define.amd) {
        define([], function() {
          return distance2;
        });
      } else if (typeof exports === "object") {
        module.exports = distance2;
      } else {
        root.distance = distance2;
      }
    })(exports);
  }
});

// src/util/openapi/openapi-cache.ts
import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";

// src/util/openapi/constants.ts
var OPENAPI_URL = "https://openapi.vercel.sh/";
var CACHE_FILE = "openapi-spec.json";
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 10 * 1e3;

// src/util/openapi/openapi-cache.ts
var OpenApiCache = class {
  constructor() {
    this.spec = null;
    this.cachePath = join(global_path_default(), CACHE_FILE);
  }
  /**
   * Check if the spec has been loaded
   */
  get isLoaded() {
    return this.spec !== null;
  }
  /**
   * Load the OpenAPI spec, using cache if available and fresh.
   * Returns true if successful, false otherwise.
   */
  async load(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await this.readCache();
      if (cached && !this.isExpired(cached.fetchedAt)) {
        output_manager_default.debug("Using cached OpenAPI spec");
        this.spec = cached.spec;
        return true;
      }
    }
    try {
      output_manager_default.debug("Fetching OpenAPI spec from " + OPENAPI_URL);
      this.spec = await this.fetchSpec();
      await this.saveCache(this.spec);
      return true;
    } catch (err) {
      output_manager_default.debug(`Failed to fetch OpenAPI spec: ${err}`);
      const stale = await this.readCache();
      if (stale) {
        output_manager_default.debug("Using stale cached OpenAPI spec");
        this.spec = stale.spec;
        return true;
      }
      return false;
    }
  }
  /**
   * Load the OpenAPI spec with spinner UI.
   * Returns true if successful, false otherwise.
   */
  async loadWithSpinner(forceRefresh = false) {
    output_manager_default.spinner(
      forceRefresh ? "Refreshing API endpoints..." : "Loading API endpoints..."
    );
    const success = await this.load(forceRefresh);
    output_manager_default.stopSpinner();
    return success;
  }
  /**
   * Get all available endpoints from the loaded spec, sorted by path then method.
   * Throws if spec hasn't been loaded yet.
   */
  getEndpoints() {
    this.ensureLoaded();
    const endpoints = this.extractEndpoints();
    return this.sortEndpoints(endpoints);
  }
  /**
   * Extract body fields from a requestBody schema.
   * Throws if spec hasn't been loaded yet.
   */
  getBodyFields(endpoint) {
    this.ensureLoaded();
    if (!endpoint.requestBody?.content)
      return [];
    const jsonContent = endpoint.requestBody.content["application/json"];
    if (!jsonContent?.schema)
      return [];
    const schema = this.resolveSchemaRef(jsonContent.schema);
    if (!schema?.properties)
      return [];
    const requiredFields = new Set(schema.required || []);
    const fields = [];
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const resolvedProp = this.resolveSchemaRef(propSchema);
      let enumValues = resolvedProp?.enum || propSchema.enum;
      if (!enumValues && (resolvedProp?.type === "array" || propSchema.type === "array")) {
        const items = resolvedProp?.items || propSchema.items;
        if (items) {
          const resolvedItems = this.resolveSchemaRef(items);
          enumValues = resolvedItems?.enum || items.enum;
        }
      }
      fields.push({
        name,
        required: requiredFields.has(name),
        description: resolvedProp?.description || propSchema.description,
        type: resolvedProp?.type || propSchema.type,
        enumValues
      });
    }
    fields.sort((a, b) => {
      if (a.required !== b.required) {
        return a.required ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return fields;
  }
  /**
   * Extract `x-vercel-cli.displayColumns` from the 200 response schema of an
   * endpoint.  Returns `null` when the spec has no display hint.
   */
  getDisplayColumns(endpoint) {
    this.ensureLoaded();
    const pathItem = this.spec.paths[endpoint.path];
    if (!pathItem)
      return null;
    const operation = pathItem[endpoint.method.toLowerCase()];
    if (!operation?.responses)
      return null;
    const ok = operation.responses["200"] || operation.responses["201"];
    if (!ok)
      return null;
    const jsonContent = ok.content?.["application/json"];
    if (!jsonContent?.schema)
      return null;
    return this.findDisplayColumns(jsonContent.schema);
  }
  findDisplayColumns(schema) {
    const xCli = schema["x-vercel-cli"];
    if (xCli?.displayColumns)
      return xCli.displayColumns;
    for (const key of ["oneOf", "allOf", "anyOf"]) {
      const variants = schema[key];
      if (variants) {
        for (const sub of variants) {
          const found = this.findDisplayColumns(sub);
          if (found)
            return found;
        }
      }
    }
    return null;
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Ensure the spec is loaded before accessing it
   */
  ensureLoaded() {
    if (!this.spec) {
      throw new Error(
        "OpenAPI spec not loaded. Call load() or loadWithSpinner() first."
      );
    }
  }
  /**
   * Read cached spec from disk
   */
  async readCache() {
    try {
      const content = await readFile(this.cachePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  /**
   * Save spec to disk cache
   */
  async saveCache(spec) {
    const cached = {
      fetchedAt: Date.now(),
      spec
    };
    const dir = join(this.cachePath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cached));
    output_manager_default.debug("Saved OpenAPI spec to cache");
  }
  /**
   * Fetch OpenAPI spec from remote with timeout
   */
  async fetchSpec() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAPI_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
  /**
   * Check if cached spec is expired
   */
  isExpired(fetchedAt) {
    return Date.now() - fetchedAt > CACHE_TTL_MS;
  }
  /**
   * Sort endpoints by path, then by method
   */
  sortEndpoints(endpoints) {
    return endpoints.sort((a, b) => {
      const pathCompare = a.path.localeCompare(b.path);
      if (pathCompare !== 0)
        return pathCompare;
      return a.method.localeCompare(b.method);
    });
  }
  /**
   * Extract all available endpoints from the spec
   */
  extractEndpoints() {
    const endpoints = [];
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods = ["get", "post", "put", "patch", "delete"];
      for (const method of methods) {
        const operation = pathItem[method];
        if (operation) {
          const pathParams = pathItem.parameters || [];
          const opParams = operation.parameters || [];
          const allParams = [...pathParams, ...opParams];
          endpoints.push({
            path,
            method: method.toUpperCase(),
            summary: operation.summary || pathItem.summary || "",
            description: operation.description || pathItem.description || "",
            operationId: operation.operationId || "",
            tags: operation.tags || [],
            parameters: allParams,
            requestBody: operation.requestBody
          });
        }
      }
    }
    return endpoints;
  }
  /**
   * Resolve a $ref to its actual schema
   */
  resolveSchemaRef(schema) {
    if (!schema)
      return void 0;
    if (schema.$ref) {
      const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
      if (match && this.spec.components?.schemas) {
        const resolved = this.spec.components.schemas[match[1]];
        return this.resolveSchemaRef(resolved);
      }
      return void 0;
    }
    if (schema.allOf && schema.allOf.length > 0) {
      const merged = { type: "object", properties: {}, required: [] };
      for (const subSchema of schema.allOf) {
        const resolved = this.resolveSchemaRef(subSchema);
        if (resolved) {
          if (resolved.properties) {
            merged.properties = {
              ...merged.properties,
              ...resolved.properties
            };
          }
          if (resolved.required) {
            merged.required = [
              ...merged.required || [],
              ...resolved.required
            ];
          }
        }
      }
      return merged;
    }
    return schema;
  }
};

// src/util/openapi/matches-cli-api-tag.ts
async function matchesCliApiTag(tagHint) {
  if (!tagHint || tagHint.startsWith("-") || tagHint.includes("/")) {
    return false;
  }
  const cache = new OpenApiCache();
  const loaded = await cache.load();
  if (!loaded) {
    return false;
  }
  const endpoints = cache.getEndpoints();
  const lower = tagHint.toLowerCase();
  return endpoints.some((ep) => ep.tags.some((t) => t.toLowerCase() === lower));
}
async function resolveOpenApiTagForProjectsCli() {
  if (await matchesCliApiTag("projects")) {
    return "projects";
  }
  if (await matchesCliApiTag("project")) {
    return "project";
  }
  return null;
}
async function resolveOpenApiTagForTeamsCli() {
  if (await matchesCliApiTag("teams")) {
    return "teams";
  }
  if (await matchesCliApiTag("team")) {
    return "team";
  }
  return null;
}

// src/commands/api/index.ts
var import_chalk4 = __toESM(require_source(), 1);

// src/util/telemetry/commands/api/index.ts
var ApiTelemetryClient = class extends TelemetryClient {
  trackCliArgumentEndpoint(endpoint) {
    if (endpoint) {
      const normalized = this.normalizeEndpoint(endpoint);
      this.trackCliArgument({
        arg: "endpoint",
        value: normalized
      });
    }
  }
  trackCliArgumentOperationId(operationId) {
    if (operationId) {
      this.trackCliArgument({
        arg: "operationId",
        value: operationId
      });
    }
  }
  trackCliOptionMethod(method) {
    if (method) {
      const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
      const upperMethod = method.toUpperCase();
      const value = validMethods.includes(upperMethod) ? upperMethod : this.redactedValue;
      this.trackCliOption({
        option: "method",
        value
      });
    }
  }
  trackCliOptionField(fields) {
    if (fields && fields.length > 0) {
      this.trackCliOption({
        option: "field",
        value: this.redactedArgumentsLength(fields)
      });
    }
  }
  trackCliOptionRawField(fields) {
    if (fields && fields.length > 0) {
      this.trackCliOption({
        option: "raw-field",
        value: this.redactedArgumentsLength(fields)
      });
    }
  }
  trackCliOptionHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "header",
        value: this.redactedArgumentsLength(headers)
      });
    }
  }
  trackCliOptionInput(input) {
    if (input) {
      const value = input === "-" ? "stdin" : "file";
      this.trackCliOption({
        option: "input",
        value
      });
    }
  }
  trackCliFlagPaginate(value) {
    if (value) {
      this.trackCliFlag("paginate");
    }
  }
  trackCliFlagInclude(value) {
    if (value) {
      this.trackCliFlag("include");
    }
  }
  trackCliFlagSilent(value) {
    if (value) {
      this.trackCliFlag("silent");
    }
  }
  trackCliFlagVerbose(value) {
    if (value) {
      this.trackCliFlag("verbose");
    }
  }
  trackCliFlagRaw(value) {
    if (value) {
      this.trackCliFlag("raw");
    }
  }
  trackCliFlagRefresh(value) {
    if (value) {
      this.trackCliFlag("refresh");
    }
  }
  trackCliOptionGenerate(format) {
    if (format) {
      const validFormats = ["curl"];
      const value = validFormats.includes(format) ? format : this.redactedValue;
      this.trackCliOption({
        option: "generate",
        value
      });
    }
  }
  trackCliFlagDangerouslySkipPermissions(value) {
    if (value) {
      this.trackCliFlag("dangerously-skip-permissions");
    }
  }
  trackCliSubcommandList() {
    this.trackCliSubcommand({ subcommand: "list", value: "list" });
  }
  trackCliOptionFormat(format) {
    if (format) {
      const validFormats = ["table", "json"];
      const value = validFormats.includes(format) ? format : this.redactedValue;
      this.trackCliOption({
        option: "format",
        value
      });
    }
  }
  /**
   * Normalize endpoint by replacing IDs with placeholders for privacy
   */
  normalizeEndpoint(endpoint) {
    return endpoint.replace(/\/dpl_[a-zA-Z0-9]+/g, "/:deploymentId").replace(/\/prj_[a-zA-Z0-9]+/g, "/:projectId").replace(/\/team_[a-zA-Z0-9]+/g, "/:teamId").replace(/\/[a-f0-9]{24}/g, "/:id").replace(/\/[a-f0-9-]{36}/g, "/:uuid");
  }
};

// src/commands/api/request-builder.ts
import { readFile as readFile2 } from "fs/promises";
import { resolve } from "path";
async function buildRequest(endpoint, flags) {
  const headers = {};
  let body;
  const customHeaders = flags["--header"] || [];
  for (const header of customHeaders) {
    const colonIndex = header.indexOf(":");
    if (colonIndex > 0) {
      const key = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }
  const fields = flags["--field"] || [];
  const rawFields = flags["--raw-field"] || [];
  if (fields.length > 0 || rawFields.length > 0) {
    body = {};
    for (const field of fields) {
      const { key, value } = await parseField(field, true);
      body[key] = value;
    }
    for (const field of rawFields) {
      const { key, value } = await parseField(field, false);
      body[key] = value;
    }
  }
  if (flags["--input"]) {
    const inputPath = flags["--input"];
    if (inputPath === "-") {
      body = await readStdin();
    } else {
      body = await readFile2(resolve(inputPath), "utf-8");
    }
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
  }
  let method = flags["--method"]?.toUpperCase() || "GET";
  if (!flags["--method"] && body) {
    method = "POST";
  }
  return {
    url: endpoint,
    method,
    headers,
    body
  };
}
async function parseCliKeyValueField(field, typed) {
  return parseField(field, typed);
}
async function parseField(field, typed) {
  const eqIndex = field.indexOf("=");
  if (eqIndex === -1) {
    throw new Error(`Invalid field format: ${field}. Expected key=value`);
  }
  const key = field.substring(0, eqIndex);
  let value = field.substring(eqIndex + 1);
  if (typed && typeof value === "string") {
    if (value.startsWith("@")) {
      const filePath = value.substring(1);
      if (filePath === "-") {
        value = await readStdin();
      } else {
        value = await readFile2(resolve(filePath), "utf-8");
      }
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
        }
      }
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (value === "null") {
      value = null;
    } else if (/^-?\d+$/.test(value)) {
      value = parseInt(value, 10);
    } else if (/^-?\d*\.\d+$/.test(value)) {
      value = parseFloat(value);
    } else if (value.startsWith("[") || value.startsWith("{")) {
      try {
        value = JSON.parse(value);
      } catch {
      }
    }
  }
  return { key, value };
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString(
    "utf-8"
  );
}
function formatOutput(data, options) {
  if (options.raw) {
    if (typeof data === "string") {
      return data;
    }
    return JSON.stringify(data);
  }
  return JSON.stringify(data, null, 2);
}
function generateCurlCommand(config, baseUrl) {
  const parts = ["curl"];
  if (config.method !== "GET") {
    parts.push(`-X ${config.method}`);
  }
  parts.push(`-H 'Authorization: Bearer <TOKEN>'`);
  for (const [key, value] of Object.entries(config.headers)) {
    parts.push(`-H '${key}: ${escapeShellArg(value)}'`);
  }
  if (config.body) {
    const bodyStr = typeof config.body === "string" ? config.body : JSON.stringify(config.body);
    parts.push(`-H 'Content-Type: application/json'`);
    parts.push(`-d '${escapeShellArg(bodyStr)}'`);
  }
  const fullUrl = `${baseUrl}${config.url}`;
  parts.push(`'${fullUrl}'`);
  return parts.join(" \\\n  ");
}
function escapeShellArg(str) {
  return str.replace(/'/g, "'\\''");
}

// src/commands/api/operation-request-builder.ts
import { readFile as readFile3 } from "fs/promises";
import { resolve as resolve2 } from "path";
var GLOBAL_CLI_QUERY_PARAMS = /* @__PURE__ */ new Set(["teamId", "slug"]);
async function parseOperationKeyValuePairs(endpoint, bodyFields, flags, positionalKeyValues) {
  const pathParamNames = new Set(
    endpoint.parameters.filter((p) => p.in === "path").map((p) => p.name)
  );
  const queryParamNames = new Set(
    endpoint.parameters.filter((p) => p.in === "query").map((p) => p.name)
  );
  const headerParamNames = new Set(
    endpoint.parameters.filter((p) => p.in === "header").map((p) => p.name)
  );
  const bodyFieldNames = new Set(bodyFields.map((f) => f.name));
  const pathValues = {};
  const queryValues = {};
  const headerValues = {};
  const body = {};
  async function dispatchPair(field, typed) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(
        `Invalid option "${field}". Expected key=value (or use flags -F / -f).`
      );
    }
    const key = field.slice(0, eqIndex);
    const param = endpoint.parameters.find((p) => p.name === key);
    if (param?.in === "path") {
      const { value } = await parseCliKeyValueField(field, false);
      pathValues[key] = String(value);
      return;
    }
    if (param?.in === "query") {
      const { value } = await parseCliKeyValueField(field, typed);
      queryValues[key] = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
      return;
    }
    if (param?.in === "header") {
      const { value } = await parseCliKeyValueField(field, false);
      headerValues[key] = String(value);
      return;
    }
    if (param?.in === "cookie") {
      throw new Error(
        `Option "${key}" is cookie-based; set it via headers instead.`
      );
    }
    if (bodyFieldNames.has(key)) {
      const { value } = await parseCliKeyValueField(field, typed);
      body[key] = value;
      return;
    }
    if (!param && pathParamNames.has(key)) {
      const { value } = await parseCliKeyValueField(field, false);
      pathValues[key] = String(value);
      return;
    }
    if (!param && queryParamNames.has(key)) {
      const { value } = await parseCliKeyValueField(field, typed);
      queryValues[key] = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
      return;
    }
    if (!param && headerParamNames.has(key)) {
      const { value } = await parseCliKeyValueField(field, false);
      headerValues[key] = String(value);
      return;
    }
    throw new Error(
      `Unknown option "${key}" for operation ${endpoint.operationId}. Check the API docs or run \`vercel api ls --format json\`.`
    );
  }
  for (const field of flags["--field"] || []) {
    await dispatchPair(field, true);
  }
  for (const field of flags["--raw-field"] || []) {
    await dispatchPair(field, false);
  }
  for (const field of positionalKeyValues) {
    await dispatchPair(field, true);
  }
  return { pathValues, queryValues, headerValues, body };
}
function getMissingRequiredOperationParams(endpoint, bodyFields, parsed, flags) {
  const pathParams = endpoint.parameters.filter((p) => p.in === "path");
  const missingPath = pathParams.filter(
    (p) => parsed.pathValues[p.name] === void 0
  );
  const requiredQuery = endpoint.parameters.filter(
    (p) => p.in === "query" && p.required && !GLOBAL_CLI_QUERY_PARAMS.has(p.name)
  );
  const missingQuery = requiredQuery.filter(
    (p) => parsed.queryValues[p.name] === void 0
  );
  const requiredHeader = endpoint.parameters.filter(
    (p) => p.in === "header" && p.required
  );
  const missingHeader = requiredHeader.filter(
    (p) => parsed.headerValues[p.name] === void 0
  );
  const missingBody = bodyFields.filter(
    (f) => f.required && parsed.body[f.name] === void 0 && !flags["--input"]
  );
  return {
    path: missingPath,
    query: missingQuery,
    header: missingHeader,
    body: missingBody
  };
}
function getUnsetOptionalOperationParams(endpoint, bodyFields, parsed, flags) {
  const unsetQuery = endpoint.parameters.filter(
    (p) => p.in === "query" && parsed.queryValues[p.name] === void 0 && (!p.required || GLOBAL_CLI_QUERY_PARAMS.has(p.name))
  );
  const unsetHeader = endpoint.parameters.filter(
    (p) => p.in === "header" && !p.required && parsed.headerValues[p.name] === void 0
  );
  const unsetBody = bodyFields.filter(
    (f) => !f.required && parsed.body[f.name] === void 0 && !flags["--input"]
  );
  return {
    query: unsetQuery,
    header: unsetHeader,
    body: unsetBody
  };
}
async function buildRequestForResolvedOperation(endpoint, bodyFields, flags, positionalKeyValues) {
  const headers = {};
  const customHeaders = flags["--header"] || [];
  for (const header of customHeaders) {
    const colonIndex = header.indexOf(":");
    if (colonIndex > 0) {
      const key = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }
  const method = (flags["--method"]?.toUpperCase() || endpoint.method).toUpperCase();
  const pathParamNames = new Set(
    endpoint.parameters.filter((p) => p.in === "path").map((p) => p.name)
  );
  const parsed = await parseOperationKeyValuePairs(
    endpoint,
    bodyFields,
    flags,
    positionalKeyValues
  );
  const { pathValues, queryValues, headerValues, body } = parsed;
  for (const [k, v] of Object.entries(headerValues)) {
    headers[k] = v;
  }
  let urlPath = endpoint.path;
  for (const name of pathParamNames) {
    const value = pathValues[name];
    if (value === void 0) {
      throw new Error(
        `Missing required path option {${name}} for ${endpoint.operationId}.`
      );
    }
    urlPath = urlPath.replace(`{${name}}`, encodeURIComponent(value));
  }
  if (/\{[^}]+\}/.test(urlPath)) {
    throw new Error(
      `Unresolved path placeholders in ${urlPath}. Provide values for all path options.`
    );
  }
  const requiredQuery = endpoint.parameters.filter(
    (p) => p.in === "query" && p.required && !GLOBAL_CLI_QUERY_PARAMS.has(p.name)
  );
  for (const p of requiredQuery) {
    if (queryValues[p.name] === void 0) {
      throw new Error(
        `Missing required query option "${p.name}" for ${endpoint.operationId}.`
      );
    }
  }
  const requiredHeader = endpoint.parameters.filter(
    (h) => h.in === "header" && h.required
  );
  for (const h of requiredHeader) {
    if (headerValues[h.name] === void 0) {
      throw new Error(
        `Missing required header option "${h.name}" for ${endpoint.operationId}.`
      );
    }
  }
  const requiredBody = bodyFields.filter((f) => f.required);
  for (const f of requiredBody) {
    if (body[f.name] === void 0 && !flags["--input"]) {
      throw new Error(
        `Missing required body option "${f.name}" for ${endpoint.operationId}.`
      );
    }
  }
  const queryString = new URLSearchParams(queryValues).toString();
  if (queryString) {
    urlPath += (urlPath.includes("?") ? "&" : "?") + queryString;
  }
  let finalBody = Object.keys(body).length > 0 ? body : void 0;
  if (flags["--input"]) {
    const inputPath = flags["--input"];
    let inputBody;
    if (inputPath === "-") {
      inputBody = await readStdin();
    } else {
      inputBody = await readFile3(resolve2(inputPath), "utf-8");
    }
    if (typeof inputBody === "string") {
      try {
        finalBody = JSON.parse(inputBody);
      } catch {
        finalBody = inputBody;
      }
    } else {
      finalBody = inputBody;
    }
  }
  if (method === "GET" || method === "HEAD") {
    finalBody = void 0;
  }
  return {
    url: urlPath,
    method,
    headers,
    body: finalBody
  };
}

// src/util/openapi/vercel-cli-table.ts
var import_ms = __toESM(require_ms(), 1);
var import_chalk = __toESM(require_source(), 1);

// src/util/openapi/resolve-by-tag-operation.ts
function resolveEndpointByTagAndOperationId(endpoints, tag, operationHint) {
  const tagLower = tag.toLowerCase();
  const tagMatches = endpoints.filter(
    (ep) => ep.tags.some((t) => t.toLowerCase() === tagLower)
  );
  if (tagMatches.length === 0) {
    return {
      ok: false,
      reason: "no_tag",
      tag,
      tagMatches: [],
      operationHint
    };
  }
  const withOpId = tagMatches.filter((ep) => ep.operationId.length > 0);
  if (withOpId.length === 0) {
    return {
      ok: false,
      reason: "no_operation",
      tag,
      tagMatches,
      operationHint
    };
  }
  const hint = operationHint.trim();
  const hintLower = hint.toLowerCase();
  const exact = withOpId.filter((ep) => ep.operationId === hint);
  if (exact.length === 1) {
    return { ok: true, endpoint: exact[0] };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_operation",
      tag,
      tagMatches: exact,
      operationHint: hint
    };
  }
  const exactCi = withOpId.filter(
    (ep) => ep.operationId.toLowerCase() === hintLower
  );
  if (exactCi.length === 1) {
    return { ok: true, endpoint: exactCi[0] };
  }
  if (exactCi.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_operation",
      tag,
      tagMatches: exactCi,
      operationHint: hint
    };
  }
  return {
    ok: false,
    reason: "no_operation",
    tag,
    tagMatches,
    operationHint: hint
  };
}

// src/util/openapi/try-openapi-fallback.ts
async function tryOpenApiFallback(client, cliArgs, resolveTag) {
  if (!process.env.VERCEL_AUTO_API) {
    return null;
  }
  const operationHint = cliArgs[0];
  if (!operationHint || operationHint.startsWith("-")) {
    return null;
  }
  const tag = await resolveTag();
  if (!tag) {
    return null;
  }
  const apiFlagsSpec = getFlagsSpecification(apiCommand.options);
  let apiParsed;
  try {
    apiParsed = parseArguments(client.argv.slice(2), apiFlagsSpec, {
      permissive: true
    });
  } catch {
    return null;
  }
  const flags = apiParsed.flags;
  if (flags["--dangerously-skip-permissions"]) {
    client.dangerouslySkipPermissions = true;
  }
  if (flags["--help"]) {
    return printOperationHelpForTagCommand(flags, tag, operationHint);
  }
  return runTagOperation(client, {
    tag,
    operationId: operationHint,
    flags,
    positionalOperationFields: cliArgs.slice(1)
  });
}

// src/commands/api/constants.ts
var API_BASE_URL = "https://api.vercel.com";

// src/commands/api/format-utils.ts
var import_chalk2 = __toESM(require_source(), 1);
function colorizeMethod(method) {
  switch (method) {
    case "GET":
      return import_chalk2.default.cyan(method);
    case "POST":
      return import_chalk2.default.green(method);
    case "PUT":
      return import_chalk2.default.yellow(method);
    case "PATCH":
      return import_chalk2.default.blue(method);
    case "DELETE":
      return import_chalk2.default.red(method);
    default:
      return method;
  }
}
function colorizeMethodPadded(method, width = 7) {
  const colored = colorizeMethod(method);
  const padding = " ".repeat(Math.max(0, width - method.length));
  return colored + padding;
}
function formatPathParam(paramName) {
  return import_chalk2.default.cyan(`{${paramName}}`);
}
function formatTypeHint(type) {
  return import_chalk2.default.dim(`[${type}]`);
}
function formatDescription(description) {
  if (!description)
    return "";
  return import_chalk2.default.gray(` (${description})`);
}

// src/commands/api/display-columns.ts
var import_chalk3 = __toESM(require_source(), 1);
function getByPath(obj, path) {
  let current = obj;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object")
      return void 0;
    current = current[segment];
  }
  return current;
}
function parseArrayColumns(data, columns) {
  const entries = Object.entries(columns);
  const first = entries[0];
  if (!first)
    return null;
  const bracketIdx = first[1].indexOf("[].");
  if (bracketIdx === -1)
    return null;
  const arrayKey = first[1].slice(0, bracketIdx);
  const rowColumns = {};
  for (const [label, path] of entries) {
    const prefix = path.slice(0, bracketIdx);
    if (prefix !== arrayKey || !path.startsWith(prefix + "[].")) {
      return null;
    }
    rowColumns[label] = path.slice(bracketIdx + 3);
  }
  const arr = getByPath(data, arrayKey);
  if (!Array.isArray(arr))
    return null;
  return { rows: arr, rowColumns };
}
function formatValue(value) {
  if (value === null || value === void 0)
    return import_chalk3.default.dim("\u2013");
  if (typeof value === "number") {
    if (value > 1e12 && value < 2e12) {
      return new Date(value).toISOString();
    }
    return String(value);
  }
  if (typeof value === "boolean")
    return String(value);
  if (typeof value === "string")
    return value;
  return JSON.stringify(value);
}
function renderCard(data, columns) {
  const entries = Object.entries(columns);
  const maxLabel = Math.max(...entries.map(([label]) => label.length));
  const lines = entries.map(([label, path]) => {
    const value = getByPath(data, path);
    return `  ${import_chalk3.default.gray(label.padEnd(maxLabel))}  ${formatValue(value)}`;
  });
  return lines.join("\n");
}
function renderTable(rows, columns) {
  const entries = Object.entries(columns);
  const headerRow = entries.map(([label]) => label);
  const dataRows = rows.map(
    (row) => entries.map(([, path]) => formatValue(getByPath(row, path)))
  );
  const widths = entries.map(([label], colIdx) => {
    const dataMax = dataRows.reduce(
      (max, row) => Math.max(max, stripAnsi(row[colIdx]).length),
      0
    );
    return Math.max(label.length, dataMax);
  });
  const header = headerRow.map((h, i) => import_chalk3.default.bold(h.padEnd(widths[i]))).join("  ");
  const body = dataRows.map(
    (row) => row.map((cell, i) => {
      const pad = widths[i] - stripAnsi(cell).length;
      return cell + " ".repeat(Math.max(0, pad));
    }).join("  ")
  );
  return [header, ...body].join("\n");
}
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// src/commands/api/index.ts
async function api(client) {
  const telemetryClient = new ApiTelemetryClient({
    opts: { store: client.telemetryEventStore }
  });
  let parsedArgs;
  const flagsSpec = getFlagsSpecification(apiCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpec, {
      permissive: true
    });
  } catch (err) {
    printError(err);
    return 1;
  }
  const { args, flags } = parsedArgs;
  const needHelp = flags["--help"];
  const firstArg = args[1];
  if (firstArg === "ls" || firstArg === "list") {
    const lsFlagsSpec = getFlagsSpecification(listSubcommand.options);
    let lsParsedArgs;
    try {
      lsParsedArgs = parseArguments(client.argv.slice(2), lsFlagsSpec);
    } catch (err) {
      printError(err);
      return 1;
    }
    const lsFlags = lsParsedArgs.flags;
    if (lsFlags["--help"]) {
      telemetryClient.trackCliFlagHelp("api", firstArg);
      output_manager_default.print(
        help(listSubcommand, {
          parent: apiCommand,
          columns: client.stderr.columns
        })
      );
      return 2;
    }
    telemetryClient.trackCliSubcommandList();
    if (lsFlags["--refresh"])
      telemetryClient.trackCliFlagRefresh(true);
    if (lsFlags["--format"])
      telemetryClient.trackCliOptionFormat(lsFlags["--format"]);
    return listEndpoints(
      client,
      lsFlags["--refresh"] ?? false,
      lsFlags["--format"] ?? "table"
    );
  }
  if (needHelp) {
    telemetryClient.trackCliFlagHelp("api");
    output_manager_default.print(help(apiCommand, { columns: client.stderr.columns }));
    return 2;
  }
  if (flags["--dangerously-skip-permissions"]) {
    client.dangerouslySkipPermissions = true;
  }
  let endpoint;
  let selectedMethod;
  let selectedBodyFields = [];
  if (!firstArg) {
    if (client.stdin.isTTY) {
      const selected = await promptEndpointSelection(
        client,
        flags["--refresh"] ?? false
      );
      if (!selected) {
        return 1;
      }
      endpoint = selected.finalUrl;
      selectedMethod = selected.method;
      selectedBodyFields = selected.bodyFields;
    } else {
      output_manager_default.error("Endpoint is required. Usage: vercel api <endpoint>");
      return 1;
    }
  } else {
    endpoint = firstArg;
  }
  if (endpoint && !endpoint.startsWith("/")) {
    output_manager_default.error(
      `Invalid arguments. Use an API path starting with /, or run \`${packageName} api\` interactively.`
    );
    return 1;
  }
  try {
    const resolvedUrl = new URL(endpoint, API_BASE_URL);
    if (resolvedUrl.origin !== API_BASE_URL) {
      output_manager_default.error(
        "Invalid endpoint: must be a Vercel API path, not an external URL"
      );
      return 1;
    }
  } catch {
    output_manager_default.error("Invalid endpoint URL format");
    return 1;
  }
  const finalFlags = { ...flags };
  if (selectedMethod && !flags["--method"]) {
    finalFlags["--method"] = selectedMethod;
  }
  if (selectedBodyFields.length > 0) {
    const existingFields = finalFlags["--field"] || [];
    finalFlags["--field"] = [...existingFields, ...selectedBodyFields];
  }
  let requestConfig;
  try {
    requestConfig = await buildRequest(endpoint, finalFlags);
  } catch (err) {
    printError(err);
    return 1;
  }
  telemetryClient.trackCliArgumentEndpoint(requestConfig.url);
  telemetryClient.trackCliArgumentOperationId(void 0);
  telemetryClient.trackCliOptionMethod(flags["--method"]);
  telemetryClient.trackCliOptionHeader(flags["--header"]);
  telemetryClient.trackCliOptionInput(flags["--input"]);
  if (flags["--paginate"])
    telemetryClient.trackCliFlagPaginate(true);
  if (flags["--include"])
    telemetryClient.trackCliFlagInclude(true);
  if (flags["--silent"])
    telemetryClient.trackCliFlagSilent(true);
  if (flags["--verbose"])
    telemetryClient.trackCliFlagVerbose(true);
  if (flags["--raw"])
    telemetryClient.trackCliFlagRaw(true);
  if (flags["--refresh"])
    telemetryClient.trackCliFlagRefresh(true);
  if (flags["--generate"])
    telemetryClient.trackCliOptionGenerate(flags["--generate"]);
  if (flags["--dangerously-skip-permissions"])
    telemetryClient.trackCliFlagDangerouslySkipPermissions(true);
  if (flags["--generate"] === "curl") {
    const curlCmd = generateCurlCommand(
      requestConfig,
      "https://api.vercel.com"
    );
    output_manager_default.log("");
    output_manager_default.log("Replace <TOKEN> with your auth token:");
    output_manager_default.log("");
    client.stdout.write(curlCmd + "\n");
    return 0;
  }
  return executeApiRequest(client, requestConfig, finalFlags);
}
async function printOperationHelpForTagCommand(flags, tag, operationId) {
  const openApi = new OpenApiCache();
  const loaded = await openApi.loadWithSpinner(flags["--refresh"] ?? false);
  if (!loaded) {
    output_manager_default.error("Could not load API specification");
    return 1;
  }
  const allEndpoints = openApi.getEndpoints();
  const resolved = resolveEndpointByTagAndOperationId(
    allEndpoints,
    tag,
    operationId
  );
  if (!resolved.ok) {
    printTagOperationResolveError(resolved, allEndpoints);
    return 1;
  }
  const ep = resolved.endpoint;
  const bodyFields = openApi.getBodyFields(ep);
  printOperationHelpDetails(ep, bodyFields, tag);
  return 2;
}
function printOperationHelpDetails(ep, bodyFields, tag) {
  const lines = [];
  lines.push("");
  lines.push(import_chalk4.default.bold(ep.operationId || "(operation)"));
  const blurb = ep.summary?.trim() || ep.description?.trim();
  if (blurb) {
    lines.push("");
    lines.push(import_chalk4.default.dim(blurb));
  }
  lines.push("");
  lines.push(import_chalk4.default.bold("Options"));
  lines.push("");
  const pathParams = ep.parameters.filter((p) => p.in === "path");
  const orderedParams = [
    ...pathParams,
    ...ep.parameters.filter((p) => p.in === "query"),
    ...ep.parameters.filter((p) => p.in === "header"),
    ...ep.parameters.filter((p) => p.in === "cookie")
  ];
  for (const p of orderedParams) {
    const globalNote = p.in === "query" && GLOBAL_CLI_QUERY_PARAMS.has(p.name) ? import_chalk4.default.dim(" (often set via --scope)") : "";
    let reqLabel;
    if (p.in === "query") {
      reqLabel = p.required && !GLOBAL_CLI_QUERY_PARAMS.has(p.name) ? import_chalk4.default.red("required") : import_chalk4.default.dim("optional");
    } else if (p.in === "path") {
      reqLabel = p.required !== false ? import_chalk4.default.red("required") : import_chalk4.default.dim("optional");
    } else if (p.in === "header") {
      reqLabel = p.required ? import_chalk4.default.red("required") : import_chalk4.default.dim("optional");
    } else {
      reqLabel = p.required ? import_chalk4.default.red("required") : import_chalk4.default.dim("optional");
    }
    lines.push(
      `  ${import_chalk4.default.cyan(p.name)}  ${reqLabel}${globalNote}${formatDescription(p.description)}`
    );
  }
  for (const f of bodyFields) {
    const req = f.required ? import_chalk4.default.red("required") : import_chalk4.default.dim("optional");
    const typeHint = f.type ? ` ${formatTypeHint(f.type)}` : "";
    lines.push(
      `  ${import_chalk4.default.cyan(f.name)}  ${req}${typeHint}${formatDescription(f.description)}`
    );
  }
  if (orderedParams.length === 0 && bodyFields.length === 0) {
    lines.push(import_chalk4.default.dim("  (none)"));
  }
  lines.push("");
  lines.push(import_chalk4.default.bold("Example"));
  const exampleSuffix = pathParams.length > 0 ? ` ${pathParams.map((p) => `${p.name}=<value>`).join(" ")}` : "";
  lines.push(
    import_chalk4.default.dim(`  ${packageName} api ${tag} ${ep.operationId}${exampleSuffix}`)
  );
  lines.push("");
  output_manager_default.print(lines.join("\n"));
}
function printMissingOperationParamsHelp(endpoint, missing) {
  output_manager_default.error(
    `Missing required options for operation ${import_chalk4.default.bold(endpoint.operationId)}.`
  );
  output_manager_default.log(
    import_chalk4.default.dim(
      `Pass each as key=value after the operationId, or use -F key=value. Example: \`${packageName} api ${endpoint.tags[0] ?? "tag"} ${endpoint.operationId} idOrName=my-project\``
    )
  );
  output_manager_default.log("");
  output_manager_default.log(import_chalk4.default.bold("Options"));
  output_manager_default.log("");
  for (const p of missing.path) {
    output_manager_default.log(`  ${import_chalk4.default.cyan(p.name)}${formatDescription(p.description)}`);
  }
  for (const p of missing.header) {
    output_manager_default.log(`  ${import_chalk4.default.cyan(p.name)}${formatDescription(p.description)}`);
  }
  for (const p of missing.query) {
    output_manager_default.log(`  ${import_chalk4.default.cyan(p.name)}${formatDescription(p.description)}`);
  }
  for (const f of missing.body) {
    const typeHint = f.type ? ` ${formatTypeHint(f.type)}` : "";
    output_manager_default.log(
      `  ${import_chalk4.default.cyan(f.name)}${typeHint}${formatDescription(f.description)}`
    );
  }
  output_manager_default.log("");
}
async function promptMissingParamsForTagOperation(client, endpoint, bodyFields, flags, positionalKeyValues) {
  const pos = [...positionalKeyValues];
  while (true) {
    const parsed = await (async () => {
      try {
        return await parseOperationKeyValuePairs(
          endpoint,
          bodyFields,
          flags,
          pos
        );
      } catch (err) {
        printError(err);
        return null;
      }
    })();
    if (parsed === null) {
      return null;
    }
    const missing = getMissingRequiredOperationParams(
      endpoint,
      bodyFields,
      parsed,
      flags
    );
    if (missing.path.length === 0 && missing.query.length === 0 && missing.header.length === 0 && missing.body.length === 0) {
      break;
    }
    for (const param of missing.path) {
      const value = await client.input.text({
        message: `Enter value for ${formatPathParam(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
      pos.push(`${param.name}=${value}`);
    }
    for (const param of missing.header) {
      const value = await client.input.text({
        message: `Enter value for header ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
      pos.push(`${param.name}=${value}`);
    }
    for (const param of missing.query) {
      const value = await client.input.text({
        message: `Enter value for ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
      pos.push(`${param.name}=${value}`);
    }
    for (const field of missing.body) {
      const value = await promptForBodyField(client, field, true);
      pos.push(`${field.name}=${value}`);
    }
  }
  return promptUnsetOptionalParamsForTagOperation(
    client,
    endpoint,
    bodyFields,
    flags,
    pos
  );
}
async function promptUnsetOptionalParamsForTagOperation(client, endpoint, bodyFields, flags, positionalKeyValues) {
  const pos = [...positionalKeyValues];
  const parsed = await (async () => {
    try {
      return await parseOperationKeyValuePairs(
        endpoint,
        bodyFields,
        flags,
        pos
      );
    } catch (err) {
      printError(err);
      return null;
    }
  })();
  if (parsed === null) {
    return null;
  }
  const unset = getUnsetOptionalOperationParams(
    endpoint,
    bodyFields,
    parsed,
    flags
  );
  if (unset.query.length === 0 && unset.header.length === 0 && unset.body.length === 0) {
    return pos;
  }
  if (unset.query.length > 0) {
    const selected = await client.input.checkbox({
      message: "Select optional query parameters to include:",
      pageSize: 20,
      choices: unset.query.map((p) => ({
        name: `${import_chalk4.default.cyan(p.name)}${GLOBAL_CLI_QUERY_PARAMS.has(p.name) ? import_chalk4.default.dim(" (team / scope; omit to use CLI default)") : ""}${formatDescription(p.description)}`,
        value: p.name
      }))
    });
    for (const paramName of selected) {
      const param = unset.query.find((p) => p.name === paramName);
      const value = await client.input.text({
        message: `Enter value for ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
      pos.push(`${param.name}=${value}`);
    }
  }
  if (unset.header.length > 0) {
    const selected = await client.input.checkbox({
      message: "Select optional header parameters to include:",
      pageSize: 20,
      choices: unset.header.map((p) => ({
        name: `${import_chalk4.default.cyan(p.name)}${formatDescription(p.description)}`,
        value: p.name
      }))
    });
    for (const paramName of selected) {
      const param = unset.header.find((p) => p.name === paramName);
      const value = await client.input.text({
        message: `Enter value for header ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
      pos.push(`${param.name}=${value}`);
    }
  }
  if (unset.body.length > 0) {
    const selected = await client.input.checkbox({
      message: "Select optional body fields to include:",
      pageSize: 20,
      choices: unset.body.map((f) => ({
        name: `${import_chalk4.default.cyan(f.name)}${f.type ? ` ${formatTypeHint(f.type)}` : ""}${formatDescription(f.description)}`,
        value: f.name
      }))
    });
    for (const fieldName of selected) {
      const field = unset.body.find((f) => f.name === fieldName);
      const value = await promptForBodyField(client, field, true);
      pos.push(`${field.name}=${value}`);
    }
  }
  return pos;
}
function printTagOperationResolveError(result, allEndpoints) {
  if (result.reason === "no_tag") {
    const tags = [...new Set(allEndpoints.flatMap((ep) => ep.tags || []))].sort();
    const preview = tags.slice(0, 25).join(", ");
    output_manager_default.error(
      `No operations use tag "${result.tag}".${tags.length > 0 ? ` Example tags: ${preview}${tags.length > 25 ? ", \u2026" : ""}.` : ""} Run \`vercel api ls --format json\` to inspect tags.`
    );
    return;
  }
  if (result.reason === "no_operation") {
    const ids = result.tagMatches.map((ep) => ep.operationId).filter(Boolean).sort();
    output_manager_default.error(
      `No operation matches "${result.operationHint}" under tag "${result.tag}".${ids.length > 0 ? ` Operations include: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ", \u2026" : ""}.` : ""}`
    );
    return;
  }
  const lines = result.tagMatches.map(
    (ep) => `  ${ep.operationId}  ${ep.method} ${ep.path}`
  );
  output_manager_default.error(
    `Multiple operations match "${result.operationHint}" under tag "${result.tag}":
${lines.join("\n")}`
  );
}
async function executeApiRequest(client, requestConfig, flags, displayColumns, options) {
  if (flags["--verbose"]) {
    output_manager_default.debug(`Request: ${requestConfig.method} ${requestConfig.url}`);
    if (Object.keys(requestConfig.headers).length > 0) {
      output_manager_default.debug(`Headers: ${JSON.stringify(requestConfig.headers)}`);
    }
    if (requestConfig.body) {
      output_manager_default.debug(
        `Body: ${typeof requestConfig.body === "string" ? requestConfig.body : JSON.stringify(requestConfig.body)}`
      );
    }
  }
  if (flags["--paginate"]) {
    return executePaginatedRequest(client, requestConfig, flags);
  }
  return executeSingleRequest(
    client,
    requestConfig,
    flags,
    displayColumns,
    options
  );
}
async function executeSingleRequest(client, config, flags, displayColumns, options) {
  try {
    const confirmed = await client.confirmMutatingOperation(
      config.url,
      config.method
    );
    if (!confirmed) {
      return 1;
    }
    const response = await client.fetch(config.url, {
      method: config.method,
      body: config.body,
      headers: config.headers,
      json: false
    });
    return handleResponse(
      client,
      response,
      flags,
      config.method,
      displayColumns,
      options
    );
  } catch (err) {
    output_manager_default.prettyError(err);
    return 1;
  }
}
async function executePaginatedRequest(client, config, flags) {
  const results = [];
  try {
    const confirmed = await client.confirmMutatingOperation(
      config.url,
      config.method
    );
    if (!confirmed) {
      return 1;
    }
    for await (const page of client.fetchPaginated(
      config.url,
      {
        method: config.method,
        body: config.body,
        headers: config.headers
      }
    )) {
      const data = extractPaginatedData(page);
      results.push(...data);
    }
    return outputResults(client, results, flags);
  } catch (err) {
    output_manager_default.prettyError(err);
    return 1;
  }
}
function extractPaginatedData(page) {
  for (const [key, value] of Object.entries(page)) {
    if (key !== "pagination" && Array.isArray(value)) {
      return value;
    }
  }
  const { pagination, ...rest } = page;
  return [rest];
}
async function handleResponse(client, response, flags, method, displayColumns, options) {
  if (flags["--include"]) {
    outputHeaders(client, response);
  }
  if (flags["--silent"]) {
    return response.ok ? 0 : 1;
  }
  const contentType = response.headers.get("content-type") || "";
  const isMutation = options?.tagOperation && method !== "GET";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    if (flags["--verbose"]) {
      output_manager_default.debug(
        `Response status: ${response.status} ${response.statusText}`
      );
    }
    if (displayColumns && response.ok && !flags["--raw"]) {
      return outputWithDisplayColumns(client, json, displayColumns);
    }
    if (isMutation && !flags["--raw"]) {
      if (!response.ok) {
        return outputMutationResult(client, response, method, json);
      }
      return outputMutationResult(client, response, method);
    }
    return outputResults(client, json, flags);
  }
  const text = await response.text();
  if (isMutation && !flags["--raw"]) {
    return outputMutationResult(
      client,
      response,
      method,
      response.ok ? void 0 : text
    );
  }
  client.stdout.write(text);
  return response.ok ? 0 : 1;
}
function outputHeaders(client, response) {
  client.stdout.write(`HTTP ${response.status} ${response.statusText}
`);
  response.headers.forEach((value, key) => {
    client.stdout.write(`${key}: ${value}
`);
  });
  client.stdout.write("\n");
}
function outputWithDisplayColumns(client, data, columns) {
  const parsed = parseArrayColumns(data, columns);
  if (parsed) {
    client.stdout.write(renderTable(parsed.rows, parsed.rowColumns) + "\n");
    return 0;
  }
  if (Array.isArray(data)) {
    client.stdout.write(renderTable(data, columns) + "\n");
  } else if (data && typeof data === "object") {
    client.stdout.write(renderCard(data, columns) + "\n");
  } else {
    client.stdout.write(formatOutput(data, {}) + "\n");
  }
  return 0;
}
function outputMutationResult(client, response, method, errorBody) {
  const verb = method === "POST" ? "Created" : method === "PATCH" || method === "PUT" ? "Updated" : method === "DELETE" ? "Deleted" : "Done";
  if (response.ok) {
    client.stdout.write(
      `${import_chalk4.default.green("Success")}  ${verb} ${import_chalk4.default.dim(`(${response.status})`)}
`
    );
    return 0;
  }
  const errorMessage = extractErrorMessage(errorBody);
  const statusLine = `${import_chalk4.default.red("Error")}  ${response.status} ${response.statusText}`;
  client.stdout.write(
    errorMessage ? `${statusLine}
${import_chalk4.default.dim(errorMessage)}
` : `${statusLine}
`
  );
  return 1;
}
function extractErrorMessage(body) {
  if (!body)
    return null;
  if (typeof body === "string")
    return body;
  if (typeof body === "object" && body !== null) {
    const obj = body;
    if (typeof obj.message === "string")
      return obj.message;
    const err = obj.error;
    if (err && typeof err.message === "string")
      return err.message;
  }
  return null;
}
function outputResults(client, data, flags) {
  const formatted = formatOutput(data, {
    raw: flags["--raw"]
  });
  client.stdout.write(formatted + "\n");
  return 0;
}
async function promptEndpointSelection(client, forceRefresh) {
  try {
    const openApi = new OpenApiCache();
    const success = await openApi.loadWithSpinner(forceRefresh);
    if (!success) {
      output_manager_default.error("Could not load API specification for endpoint selection");
      return null;
    }
    const endpoints = openApi.getEndpoints();
    const selectedEndpoint = await promptForEndpoint(client, endpoints);
    const bodyFieldsSpec = openApi.getBodyFields(selectedEndpoint);
    const { finalUrl, bodyFields } = await promptForParameters(
      client,
      selectedEndpoint.path,
      selectedEndpoint.parameters,
      bodyFieldsSpec
    );
    return {
      path: selectedEndpoint.path,
      method: selectedEndpoint.method,
      finalUrl,
      bodyFields
    };
  } catch (err) {
    output_manager_default.stopSpinner();
    output_manager_default.debug(`Endpoint selection failed: ${err}`);
    return null;
  }
}
async function promptForEndpoint(client, endpoints) {
  const allChoices = endpoints.map((ep) => ({
    name: `${colorizeMethodPadded(ep.method)} ${ep.path}`,
    value: ep,
    // Show full description if available, otherwise show summary
    description: ep.description || ep.summary || void 0,
    // Include summary in searchable metadata
    summary: ep.summary,
    tags: ep.tags
  }));
  const total = allChoices.length;
  return client.input.search({
    message: `Search for an API endpoint (${total} available):`,
    source: async (term) => {
      if (!term) {
        return allChoices;
      }
      const lowerTerm = term.toLowerCase();
      return allChoices.filter((choice) => {
        const searchableText = [
          choice.name,
          choice.summary || "",
          choice.description || "",
          ...choice.tags || []
        ].join(" ").toLowerCase();
        return searchableText.includes(lowerTerm);
      });
    }
  });
}
async function listEndpoints(client, forceRefresh, format) {
  const openApi = new OpenApiCache();
  const success = await openApi.loadWithSpinner(forceRefresh);
  if (!success) {
    output_manager_default.error("Could not load API specification");
    return 1;
  }
  const endpoints = openApi.getEndpoints();
  if (format === "json") {
    return outputEndpointsAsJson(client, endpoints);
  }
  return outputEndpointsAsTable(endpoints);
}
function outputEndpointsAsJson(client, endpoints) {
  const jsonOutput = endpoints.map((ep) => ({
    method: ep.method,
    path: ep.path,
    summary: ep.summary || null,
    description: ep.description || null,
    operationId: ep.operationId || null,
    tags: ep.tags
  }));
  client.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
  return 0;
}
function groupEndpointsByPath(endpoints) {
  const grouped = /* @__PURE__ */ new Map();
  for (const ep of endpoints) {
    const existing = grouped.get(ep.path) || [];
    existing.push({ method: ep.method, summary: ep.summary });
    grouped.set(ep.path, existing);
  }
  const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  for (const [path, methods] of grouped) {
    methods.sort(
      (a, b) => methodOrder.indexOf(a.method) - methodOrder.indexOf(b.method)
    );
    grouped.set(path, methods);
  }
  return grouped;
}
function outputEndpointsAsTable(endpoints) {
  const grouped = groupEndpointsByPath(endpoints);
  const methodWidth = 7;
  output_manager_default.log("");
  for (const [path, methods] of grouped) {
    output_manager_default.log(import_chalk4.default.bold(path));
    for (const { method, summary } of methods) {
      const coloredMethod = colorizeMethod(method);
      const paddedMethod = method.padEnd(methodWidth);
      const methodDisplay = coloredMethod + paddedMethod.slice(method.length);
      output_manager_default.log(`  ${methodDisplay}  ${import_chalk4.default.gray(summary || "")}`);
    }
    output_manager_default.log("");
  }
  output_manager_default.log(
    `${import_chalk4.default.bold(grouped.size.toString())} routes, ${import_chalk4.default.bold(endpoints.length.toString())} endpoints`
  );
  return 0;
}
function createRequiredValidator(fieldName) {
  return (input) => {
    if (!input.trim()) {
      return `${fieldName} is required`;
    }
    return true;
  };
}
function buildQueryString(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
async function promptForParameters(client, path, parameters, bodyFieldsSpec) {
  const globalParams = /* @__PURE__ */ new Set(["teamId", "slug"]);
  const pathParams = parameters.filter((p) => p.in === "path");
  const requiredQueryParams = parameters.filter(
    (p) => p.in === "query" && p.required && !globalParams.has(p.name)
  );
  const optionalQueryParams = parameters.filter(
    (p) => p.in === "query" && !p.required && !globalParams.has(p.name)
  );
  const requiredBodyFields = bodyFieldsSpec.filter((f) => f.required);
  const optionalBodyFields = bodyFieldsSpec.filter((f) => !f.required);
  let finalPath = path;
  for (const param of pathParams) {
    const value = await client.input.text({
      message: `Enter value for ${formatPathParam(param.name)}${formatDescription(param.description)}:`,
      validate: createRequiredValidator(param.name)
    });
    finalPath = finalPath.replace(`{${param.name}}`, encodeURIComponent(value));
  }
  const queryValues = {};
  for (const param of requiredQueryParams) {
    queryValues[param.name] = await client.input.text({
      message: `Enter value for ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
      validate: createRequiredValidator(param.name)
    });
  }
  if (optionalQueryParams.length > 0) {
    const selectedOptionalParams = await client.input.checkbox({
      message: "Select optional query parameters to include:",
      pageSize: 20,
      choices: optionalQueryParams.map((p) => ({
        name: `${import_chalk4.default.cyan(p.name)}${formatDescription(p.description)}`,
        value: p.name
      }))
    });
    for (const paramName of selectedOptionalParams) {
      const param = optionalQueryParams.find((p) => p.name === paramName);
      queryValues[param.name] = await client.input.text({
        message: `Enter value for ${import_chalk4.default.cyan(param.name)}${formatDescription(param.description)}:`,
        validate: createRequiredValidator(param.name)
      });
    }
  }
  const bodyFieldValues = [];
  for (const field of requiredBodyFields) {
    const value = await promptForBodyField(client, field, true);
    bodyFieldValues.push(`${field.name}=${value}`);
  }
  if (optionalBodyFields.length > 0) {
    const selectedOptionalFields = await client.input.checkbox({
      message: "Select optional body fields to include:",
      pageSize: 20,
      choices: optionalBodyFields.map((f) => ({
        name: `${import_chalk4.default.cyan(f.name)}${f.type ? ` ${formatTypeHint(f.type)}` : ""}${formatDescription(f.description)}`,
        value: f.name
      }))
    });
    for (const fieldName of selectedOptionalFields) {
      const field = optionalBodyFields.find((f) => f.name === fieldName);
      const value = await promptForBodyField(client, field, true);
      bodyFieldValues.push(`${field.name}=${value}`);
    }
  }
  const queryString = buildQueryString(queryValues);
  if (queryString) {
    finalPath += `?${queryString}`;
  }
  return { finalUrl: finalPath, bodyFields: bodyFieldValues };
}
async function promptForBodyField(client, field, required) {
  const description = formatDescription(field.description);
  const optionalHint = required ? "" : import_chalk4.default.dim(" (optional)");
  if (field.type === "array" && field.enumValues && field.enumValues.length > 0) {
    const choices = field.enumValues.map((v) => ({
      name: String(v),
      value: String(v)
    }));
    const selected = await client.input.checkbox({
      message: `Select values for ${import_chalk4.default.cyan(field.name)}${optionalHint}${description}:`,
      choices,
      required
    });
    return JSON.stringify(selected);
  }
  if (field.enumValues && field.enumValues.length > 0) {
    const choices = field.enumValues.map((v) => ({
      name: String(v),
      value: String(v)
    }));
    if (!required) {
      choices.unshift({ name: import_chalk4.default.dim("(skip)"), value: "" });
    }
    return client.input.select({
      message: `Select value for ${import_chalk4.default.cyan(field.name)}${optionalHint}${description}:`,
      choices
    });
  }
  const typeHint = field.type ? ` ${formatTypeHint(field.type)}` : "";
  return client.input.text({
    message: `Enter value for ${import_chalk4.default.cyan(field.name)}${optionalHint}${typeHint}${description}:`,
    validate: required ? createRequiredValidator(field.name) : void 0
  });
}
async function runTagOperation(client, options) {
  const { tag, operationId, flags, positionalOperationFields } = options;
  const telemetryClient = new ApiTelemetryClient({
    opts: { store: client.telemetryEventStore }
  });
  const finalFlags = { ...flags };
  const openApi = new OpenApiCache();
  const loaded = await openApi.loadWithSpinner(
    finalFlags["--refresh"] ?? false
  );
  if (!loaded) {
    output_manager_default.error("Could not load API specification");
    return 1;
  }
  const allEndpoints = openApi.getEndpoints();
  const resolved = resolveEndpointByTagAndOperationId(
    allEndpoints,
    tag,
    operationId
  );
  if (!resolved.ok) {
    printTagOperationResolveError(resolved, allEndpoints);
    return 1;
  }
  const bodyFields = openApi.getBodyFields(resolved.endpoint);
  const displayColumns = openApi.getDisplayColumns(resolved.endpoint);
  let tagOperationPositional = positionalOperationFields;
  if (client.stdin.isTTY) {
    const prompted = await promptMissingParamsForTagOperation(
      client,
      resolved.endpoint,
      bodyFields,
      finalFlags,
      tagOperationPositional
    );
    if (prompted === null) {
      return 1;
    }
    tagOperationPositional = prompted;
  } else {
    try {
      const parsed = await parseOperationKeyValuePairs(
        resolved.endpoint,
        bodyFields,
        finalFlags,
        tagOperationPositional
      );
      const missing = getMissingRequiredOperationParams(
        resolved.endpoint,
        bodyFields,
        parsed,
        finalFlags
      );
      if (missing.path.length > 0 || missing.query.length > 0 || missing.header.length > 0 || missing.body.length > 0) {
        printMissingOperationParamsHelp(resolved.endpoint, missing);
        return 1;
      }
    } catch (err) {
      printError(err);
      return 1;
    }
  }
  let requestConfig;
  try {
    requestConfig = await buildRequestForResolvedOperation(
      resolved.endpoint,
      bodyFields,
      finalFlags,
      tagOperationPositional
    );
  } catch (err) {
    printError(err);
    return 1;
  }
  telemetryClient.trackCliArgumentEndpoint(tag);
  telemetryClient.trackCliArgumentOperationId(operationId);
  telemetryClient.trackCliOptionMethod(finalFlags["--method"]);
  telemetryClient.trackCliOptionHeader(finalFlags["--header"]);
  telemetryClient.trackCliOptionInput(finalFlags["--input"]);
  if (finalFlags["--paginate"])
    telemetryClient.trackCliFlagPaginate(true);
  if (finalFlags["--include"])
    telemetryClient.trackCliFlagInclude(true);
  if (finalFlags["--silent"])
    telemetryClient.trackCliFlagSilent(true);
  if (finalFlags["--verbose"])
    telemetryClient.trackCliFlagVerbose(true);
  if (finalFlags["--raw"])
    telemetryClient.trackCliFlagRaw(true);
  if (finalFlags["--refresh"])
    telemetryClient.trackCliFlagRefresh(true);
  if (finalFlags["--generate"])
    telemetryClient.trackCliOptionGenerate(finalFlags["--generate"]);
  if (finalFlags["--dangerously-skip-permissions"])
    telemetryClient.trackCliFlagDangerouslySkipPermissions(true);
  if (finalFlags["--generate"] === "curl") {
    const curlCmd = generateCurlCommand(
      requestConfig,
      "https://api.vercel.com"
    );
    output_manager_default.log("");
    output_manager_default.log("Replace <TOKEN> with your auth token:");
    output_manager_default.log("");
    client.stdout.write(curlCmd + "\n");
    return 0;
  }
  return executeApiRequest(client, requestConfig, finalFlags, displayColumns, {
    tagOperation: true
  });
}

// src/util/upgrade.ts
import { spawn } from "child_process";
async function executeUpgrade() {
  const updateCommand = await getUpdateCommand();
  const [command, ...args] = updateCommand.split(" ");
  output_manager_default.log(`Upgrading Vercel CLI...`);
  output_manager_default.debug(`Executing: ${updateCommand}`);
  return new Promise((resolve3) => {
    const stdout = [];
    const stderr = [];
    const upgradeProcess = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: false
    });
    upgradeProcess.stdout?.on("data", (data) => {
      stdout.push(data);
    });
    upgradeProcess.stderr?.on("data", (data) => {
      stderr.push(data);
    });
    upgradeProcess.on("error", (err) => {
      output_manager_default.error(`Failed to execute upgrade command: ${err.message}`);
      output_manager_default.log(`You can try running the command manually: ${updateCommand}`);
      resolve3(1);
    });
    upgradeProcess.on("close", (code) => {
      if (code === 0) {
        output_manager_default.success("Vercel CLI has been upgraded successfully!");
      } else {
        const stdoutStr = Buffer.concat(stdout).toString();
        const stderrStr = Buffer.concat(stderr).toString();
        if (stdoutStr) {
          output_manager_default.print(stdoutStr);
        }
        if (stderrStr) {
          output_manager_default.print(stderrStr);
        }
        output_manager_default.error(`Upgrade failed with exit code ${code ?? "unknown"}`);
        output_manager_default.log(
          `You can try running the command manually: ${updateCommand}`
        );
      }
      resolve3(code ?? 1);
    });
  });
}

// src/commands/login/index.ts
var import_chalk5 = __toESM(require_source(), 1);

// src/util/telemetry/commands/login/index.ts
var LoginTelemetryClient = class extends TelemetryClient {
  /**
   * Tracks the state of the login process.
   * - `started` when the user initiates the login process.
   * - `canceled` when the user cancels the login process.
   * - `error` when the user encounters an error during the login process.
   * - `success` when the user successfully logs in.
   */
  trackState(...args) {
    this.trackLoginState(...args);
  }
};

// src/commands/login/index.ts
async function login2(client, options) {
  let parsedArgs = null;
  const flagsSpecification = getFlagsSpecification(loginCommand.options);
  const telemetry = new LoginTelemetryClient({
    opts: {
      store: client.telemetryEventStore
    }
  });
  try {
    if (options.shouldParseArgs) {
      parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
    }
  } catch (error) {
    printError(error);
    return 1;
  }
  if (parsedArgs?.flags["--help"]) {
    telemetry.trackCliFlagHelp("login");
    output_manager_default.print(help(loginCommand, { columns: client.stderr.columns }));
    return 0;
  }
  if (parsedArgs?.flags["--token"]) {
    output_manager_default.error('`--token` may not be used with the "login" command');
    return 2;
  }
  if (options.shouldParseArgs && parsedArgs) {
    const obsoleteFlags = Object.keys(parsedArgs.flags).filter((flag) => {
      const flagKey = flag.replace("--", "");
      const option = loginCommand.options.find((o) => o.name === flagKey);
      if (!option || typeof option === "number")
        return;
      return "deprecated" in option && option.deprecated;
    });
    if (obsoleteFlags.length) {
      const flags = obsoleteFlags.map((f) => import_chalk5.default.bold(f)).join(", ");
      output_manager_default.warn(`The following flags are deprecated: ${flags}`);
    }
    const obsoleteArguments = parsedArgs.args.slice(1);
    if (obsoleteArguments.length) {
      const args = obsoleteArguments.map((a) => import_chalk5.default.bold(a)).join(", ");
      output_manager_default.warn(`The following arguments are deprecated: ${args}`);
    }
    if (obsoleteArguments.length || obsoleteFlags.length) {
      output_manager_default.print(
        `Read more in our ${output_manager_default.link("changelog", "https://vercel.com/changelog/new-vercel-cli-login-flow")}.
`
      );
    }
  }
  telemetry.trackState("started");
  return await login(client, telemetry);
}

// src/util/output/box.ts
var import_chalk6 = __toESM(require_source(), 1);
var import_strip_ansi = __toESM(require_strip_ansi(), 1);
var border = ["\u2500", "\u256D", "\u256E", "\u2502", "\u2502", "\u2570", "\u256F"];
var nothing = ["\u2500", "", "", "", "", "", ""];
function box(message, {
  borderColor,
  padding = 1,
  textAlignment = "center",
  terminalColumns: cols = process.stdout.columns || process.env.COLUMNS && parseInt(process.env.COLUMNS, 10) || 80
} = {}) {
  const lines = message.split(/\r?\n/).map((line) => [line, (0, import_strip_ansi.default)(line).length]);
  const maxLine = lines.reduce((p, [, len]) => Math.max(p, len), 0);
  const borderColorFn = borderColor && import_chalk6.default[borderColor] || import_chalk6.default.yellow;
  const clampedSidePadding = Math.max(1, padding * 3);
  const narrowMode = maxLine + 2 + clampedSidePadding * 2 > cols;
  const sidePadding = narrowMode ? 0 : clampedSidePadding;
  const innerWidth = Math.min(maxLine + sidePadding * 2, cols);
  const [hr, topLeft, topRight, left, right, bottomLeft, bottomRight] = narrowMode ? nothing : border;
  const spacerRow = narrowMode ? "\n".repeat(padding) : `${borderColorFn(`${left}${" ".repeat(innerWidth)}${right}`)}
`.repeat(
    padding
  );
  const renderLine = ([line, len]) => {
    let leftPadding = 0;
    let rightPadding = 0;
    if (!narrowMode) {
      leftPadding = sidePadding;
      rightPadding = sidePadding;
      if (textAlignment === "center") {
        leftPadding += Math.floor((maxLine - len) / 2);
        rightPadding += maxLine - len - leftPadding + sidePadding;
      } else if (textAlignment === "right") {
        leftPadding += maxLine - len;
      } else if (textAlignment === "left") {
        rightPadding += maxLine - len;
      }
    }
    return borderColorFn(left) + " ".repeat(leftPadding) + line + " ".repeat(rightPadding) + borderColorFn(right);
  };
  return borderColorFn(`${topLeft}${hr.repeat(innerWidth)}${topRight}`) + "\n" + spacerRow + lines.map(renderLine).join("\n") + "\n" + spacerRow + borderColorFn(`${bottomLeft}${hr.repeat(innerWidth)}${bottomRight}`);
}

// src/util/did-you-mean.ts
var import_jaro_winkler = __toESM(require_jaro_winkler(), 1);
var did_you_mean_default = didYouMean;
function didYouMean(input, list, threshold = 0.5) {
  const rated = list.map((item) => [dashAwareDistance(input, item), item]);
  const found = rated.filter((item) => item[0] > threshold);
  if (found.length) {
    const highestRated = found.reduce((accu, curr) => {
      return accu[0] > curr[0] ? accu : curr;
    });
    return highestRated[1];
  }
}
function dashAwareDistance(word, dashWord) {
  const fullDistance = (0, import_jaro_winkler.default)(word, dashWord);
  const distances = dashWord.split("-").map((w) => (0, import_jaro_winkler.default)(w, word));
  const meanDistance = distances.reduce((accu, curr) => accu + curr) / distances.length;
  return fullDistance > meanDistance ? fullDistance : meanDistance;
}

export {
  did_you_mean_default,
  OpenApiCache,
  matchesCliApiTag,
  resolveOpenApiTagForProjectsCli,
  resolveOpenApiTagForTeamsCli,
  api,
  tryOpenApiFallback,
  executeUpgrade,
  login2 as login,
  box
};
