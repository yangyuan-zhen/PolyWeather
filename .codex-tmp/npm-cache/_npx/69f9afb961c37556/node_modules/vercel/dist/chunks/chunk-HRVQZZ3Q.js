import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  formatCondition,
  formatTransform
} from "./chunk-KM6BIRA3.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/routes/env.ts
function extractEnvVarNames(value) {
  const names = /* @__PURE__ */ new Set();
  for (const m of value.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)) {
    names.add(m[1]);
  }
  return Array.from(names);
}
function populateRouteEnv(route) {
  const routeEnv = /* @__PURE__ */ new Set();
  if (route.dest) {
    for (const name of extractEnvVarNames(route.dest)) {
      routeEnv.add(name);
    }
  }
  if (route.headers) {
    for (const value of Object.values(route.headers)) {
      for (const name of extractEnvVarNames(value)) {
        routeEnv.add(name);
      }
    }
  }
  route.env = routeEnv.size > 0 ? Array.from(routeEnv) : void 0;
  if (route.transforms) {
    for (const transform of route.transforms) {
      if (transform.args) {
        const argsStr = Array.isArray(transform.args) ? transform.args.join(" ") : transform.args;
        const names = extractEnvVarNames(argsStr);
        transform.env = names.length > 0 ? names : void 0;
      }
    }
  }
}

// src/util/routes/generate-route.ts
async function generateRoute(client, projectId, input, options = {}) {
  const { teamId } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes/generate${queryString ? `?${queryString}` : ""}`;
  return await client.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

// src/util/routes/parse-transforms.ts
function parseTransforms(values, type, op) {
  return values.map((value) => parseTransform(value, type, op));
}
function parseTransform(input, type, op) {
  if (op === "delete") {
    const key2 = input.trim();
    if (!key2) {
      throw new Error("Delete operation requires a key");
    }
    return {
      type,
      op,
      target: { key: key2 }
    };
  }
  const eqIndex = input.indexOf("=");
  if (eqIndex === -1) {
    throw new Error(`Invalid format: "${input}". Expected format: key=value`);
  }
  const key = input.slice(0, eqIndex).trim();
  const args = input.slice(eqIndex + 1);
  if (!key) {
    throw new Error("Transform key cannot be empty");
  }
  return {
    type,
    op,
    target: { key },
    args
  };
}
function collectTransforms(flags) {
  const transforms = [];
  if (flags.setResponseHeader) {
    transforms.push(
      ...parseTransforms(flags.setResponseHeader, "response.headers", "set")
    );
  }
  if (flags.appendResponseHeader) {
    transforms.push(
      ...parseTransforms(
        flags.appendResponseHeader,
        "response.headers",
        "append"
      )
    );
  }
  if (flags.deleteResponseHeader) {
    transforms.push(
      ...parseTransforms(
        flags.deleteResponseHeader,
        "response.headers",
        "delete"
      )
    );
  }
  if (flags.setRequestHeader) {
    transforms.push(
      ...parseTransforms(flags.setRequestHeader, "request.headers", "set")
    );
  }
  if (flags.appendRequestHeader) {
    transforms.push(
      ...parseTransforms(flags.appendRequestHeader, "request.headers", "append")
    );
  }
  if (flags.deleteRequestHeader) {
    transforms.push(
      ...parseTransforms(flags.deleteRequestHeader, "request.headers", "delete")
    );
  }
  if (flags.setRequestQuery) {
    transforms.push(
      ...parseTransforms(flags.setRequestQuery, "request.query", "set")
    );
  }
  if (flags.appendRequestQuery) {
    transforms.push(
      ...parseTransforms(flags.appendRequestQuery, "request.query", "append")
    );
  }
  if (flags.deleteRequestQuery) {
    transforms.push(
      ...parseTransforms(flags.deleteRequestQuery, "request.query", "delete")
    );
  }
  return transforms;
}
function collectResponseHeaders(setHeaders) {
  const headers = {};
  for (const input of setHeaders) {
    const eqIndex = input.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(
        `Invalid header format: "${input}". Expected format: key=value`
      );
    }
    const key = input.slice(0, eqIndex).trim();
    const value = input.slice(eqIndex + 1);
    if (!key) {
      throw new Error("Header key cannot be empty");
    }
    headers[key] = value;
  }
  return headers;
}

// src/util/routes/interactive.ts
var MAX_NAME_LENGTH = 256;
var MAX_DESCRIPTION_LENGTH = 1024;
var MAX_CONDITIONS = 16;
var VALID_SYNTAXES = [
  "regex",
  "path-to-regexp",
  "equals"
];
var REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];
var VALID_ACTION_TYPES = [
  "rewrite",
  "redirect",
  "set-status"
];
var ALL_ACTION_CHOICES = [
  { name: "Rewrite", value: "rewrite", exclusive: true },
  { name: "Redirect", value: "redirect", exclusive: true },
  { name: "Set Status Code", value: "set-status", exclusive: true },
  { name: "Response Headers", value: "response-headers" },
  { name: "Request Headers", value: "request-headers" },
  { name: "Request Query", value: "request-query" }
];
function stripQuotes(str) {
  if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
    return str.slice(1, -1);
  }
  if (str.startsWith("'") && str.endsWith("'") && str.length >= 2) {
    return str.slice(1, -1);
  }
  return str;
}
function extractTransformFlags(flags) {
  return {
    setResponseHeader: flags["--set-response-header"],
    appendResponseHeader: flags["--append-response-header"],
    deleteResponseHeader: flags["--delete-response-header"],
    setRequestHeader: flags["--set-request-header"],
    appendRequestHeader: flags["--append-request-header"],
    deleteRequestHeader: flags["--delete-request-header"],
    setRequestQuery: flags["--set-request-query"],
    appendRequestQuery: flags["--append-request-query"],
    deleteRequestQuery: flags["--delete-request-query"]
  };
}
function collectHeadersAndTransforms(transformFlags) {
  const headers = transformFlags.setResponseHeader ? collectResponseHeaders(transformFlags.setResponseHeader) : {};
  const transforms = collectTransforms({
    ...transformFlags,
    setResponseHeader: void 0
    // Already handled in headers
  });
  return { headers, transforms };
}
function hasAnyTransformFlags(flags) {
  const tf = extractTransformFlags(flags);
  return !!(tf.setResponseHeader || tf.appendResponseHeader || tf.deleteResponseHeader || tf.setRequestHeader || tf.appendRequestHeader || tf.deleteRequestHeader || tf.setRequestQuery || tf.appendRequestQuery || tf.deleteRequestQuery);
}
function validateActionFlags(action, dest, status) {
  if (!action) {
    if (dest || status !== void 0) {
      return "--action is required when using --dest or --status. Use --action rewrite, --action redirect, or --action set-status.";
    }
    return null;
  }
  if (!VALID_ACTION_TYPES.includes(action)) {
    return `Invalid action type: "${action}". Valid types: ${VALID_ACTION_TYPES.join(", ")}`;
  }
  switch (action) {
    case "rewrite":
      if (!dest)
        return "--action rewrite requires --dest.";
      if (status !== void 0)
        return "--action rewrite does not accept --status.";
      break;
    case "redirect":
      if (!dest)
        return "--action redirect requires --dest.";
      if (status === void 0)
        return `--action redirect requires --status (${REDIRECT_STATUS_CODES.join(", ")}).`;
      if (!REDIRECT_STATUS_CODES.includes(status))
        return `Invalid redirect status: ${status}. Must be one of: ${REDIRECT_STATUS_CODES.join(", ")}`;
      break;
    case "set-status":
      if (dest)
        return "--action set-status does not accept --dest.";
      if (status === void 0)
        return "--action set-status requires --status.";
      if (status < 100 || status > 599)
        return "Status code must be between 100 and 599.";
      break;
  }
  return null;
}
async function collectActionDetails(client, actionType, flags) {
  switch (actionType) {
    case "rewrite": {
      const dest = await client.input.text({
        message: "Destination URL:",
        validate: (val) => val ? true : "Destination is required"
      });
      Object.assign(flags, { "--dest": dest });
      break;
    }
    case "redirect": {
      const dest = await client.input.text({
        message: "Destination URL:",
        validate: (val) => val ? true : "Destination is required"
      });
      const status = await client.input.select({
        message: "Status code:",
        choices: [
          { name: "307 - Temporary Redirect", value: 307 },
          { name: "308 - Permanent Redirect", value: 308 },
          { name: "301 - Moved Permanently", value: 301 },
          { name: "302 - Found", value: 302 },
          { name: "303 - See Other", value: 303 }
        ]
      });
      Object.assign(flags, { "--dest": dest, "--status": status });
      break;
    }
    case "set-status": {
      const statusCode = await client.input.text({
        message: "HTTP status code:",
        validate: (val) => {
          const num = parseInt(val, 10);
          if (isNaN(num) || num < 100 || num > 599) {
            return "Status code must be between 100 and 599";
          }
          return true;
        }
      });
      Object.assign(flags, { "--status": parseInt(statusCode, 10) });
      break;
    }
    case "response-headers": {
      await collectInteractiveHeaders(client, "response", flags);
      break;
    }
    case "request-headers": {
      await collectInteractiveHeaders(client, "request-header", flags);
      break;
    }
    case "request-query": {
      await collectInteractiveHeaders(client, "request-query", flags);
      break;
    }
  }
}
async function collectInteractiveConditions(client, flags) {
  let addMore = true;
  while (addMore) {
    const currentHas = flags["--has"] || [];
    const currentMissing = flags["--missing"] || [];
    if (currentHas.length > 0 || currentMissing.length > 0) {
      output_manager_default.log("\nCurrent conditions:");
      for (const c of currentHas) {
        output_manager_default.print(`  has: ${c}
`);
      }
      for (const c of currentMissing) {
        output_manager_default.print(`  does not have: ${c}
`);
      }
      output_manager_default.print("\n");
    }
    const conditionType = await client.input.select({
      message: "Condition type:",
      choices: [
        { name: "has - Request must have this", value: "has" },
        {
          name: "does not have - Request must NOT have this",
          value: "missing"
        }
      ]
    });
    const targetType = await client.input.select({
      message: "What to check:",
      choices: [
        { name: "Header", value: "header" },
        { name: "Cookie", value: "cookie" },
        { name: "Query Parameter", value: "query" },
        { name: "Host", value: "host" }
      ]
    });
    let conditionValue;
    if (targetType === "host") {
      const operator = await client.input.select({
        message: "How to match the host:",
        choices: [
          { name: "Equals", value: "eq" },
          { name: "Contains", value: "contains" },
          { name: "Matches (regex)", value: "re" }
        ]
      });
      const hostInput = await client.input.text({
        message: operator === "re" ? "Host pattern (regex):" : "Host value:",
        validate: (val) => {
          if (!val)
            return "Host value is required";
          if (operator === "re") {
            try {
              new RegExp(val);
              return true;
            } catch {
              return "Invalid regex pattern";
            }
          }
          return true;
        }
      });
      conditionValue = `host:${operator}=${hostInput}`;
    } else {
      const key = await client.input.text({
        message: `${targetType.charAt(0).toUpperCase() + targetType.slice(1)} name:`,
        validate: (val) => val ? true : `${targetType} name is required`
      });
      const operator = await client.input.select({
        message: "How to match the value:",
        choices: [
          { name: "Exists (any value)", value: "exists" },
          { name: "Equals", value: "eq" },
          { name: "Contains", value: "contains" },
          { name: "Matches (regex)", value: "re" }
        ]
      });
      if (operator === "exists") {
        conditionValue = `${targetType}:${key}:exists`;
      } else {
        const valueInput = await client.input.text({
          message: operator === "re" ? "Value pattern (regex):" : "Value:",
          validate: (val) => {
            if (!val)
              return "Value is required";
            if (operator === "re") {
              try {
                new RegExp(val);
                return true;
              } catch {
                return "Invalid regex pattern";
              }
            }
            return true;
          }
        });
        conditionValue = `${targetType}:${key}:${operator}=${valueInput}`;
      }
    }
    const flagName = conditionType === "has" ? "--has" : "--missing";
    const existing = flags[flagName] || [];
    flags[flagName] = [...existing, conditionValue];
    const totalConditions = (flags["--has"] || []).length + (flags["--missing"] || []).length;
    if (totalConditions >= MAX_CONDITIONS) {
      output_manager_default.warn(`Maximum ${MAX_CONDITIONS} conditions reached.`);
      break;
    }
    addMore = await client.input.confirm("Add another condition?", false);
  }
}
function formatCollectedItems(flags, type) {
  const items = [];
  const prefix = type === "response" ? "response-header" : type === "request-header" ? "request-header" : "request-query";
  const setItems = flags[`--set-${prefix}`] || [];
  const appendItems = flags[`--append-${prefix}`] || [];
  const deleteItems = flags[`--delete-${prefix}`] || [];
  for (const item of setItems) {
    items.push(`  set: ${item}`);
  }
  for (const item of appendItems) {
    items.push(`  append: ${item}`);
  }
  for (const item of deleteItems) {
    items.push(`  delete: ${item}`);
  }
  return items;
}
async function collectInteractiveHeaders(client, type, flags) {
  const flagName = type === "response" ? "--set-response-header" : type === "request-header" ? "--set-request-header" : "--set-request-query";
  const sectionName = type === "response" ? "Response Headers" : type === "request-header" ? "Request Headers" : "Request Query Parameters";
  const itemName = type === "response" ? "response header" : type === "request-header" ? "request header" : "query parameter";
  output_manager_default.log(`
--- ${sectionName} ---`);
  let addMore = true;
  while (addMore) {
    const collected = formatCollectedItems(flags, type);
    if (collected.length > 0) {
      output_manager_default.log(`
Current ${sectionName.toLowerCase()}:`);
      for (const item of collected) {
        output_manager_default.print(`${item}
`);
      }
      output_manager_default.print("\n");
    }
    const op = await client.input.select({
      message: `${sectionName} operation:`,
      choices: [
        { name: "Set", value: "set" },
        { name: "Append", value: "append" },
        { name: "Delete", value: "delete" }
      ]
    });
    const key = await client.input.text({
      message: `${itemName.charAt(0).toUpperCase() + itemName.slice(1)} name:`,
      validate: (val) => val ? true : `${itemName} name is required`
    });
    if (op === "delete") {
      const opFlagName = flagName.replace("--set-", "--delete-");
      const existing = flags[opFlagName] || [];
      flags[opFlagName] = [...existing, key];
    } else {
      const value = await client.input.text({
        message: `${itemName.charAt(0).toUpperCase() + itemName.slice(1)} value:`
      });
      const opFlagName = op === "append" ? flagName.replace("--set-", "--append-") : flagName;
      const existing = flags[opFlagName] || [];
      flags[opFlagName] = [...existing, `${key}=${value}`];
    }
    addMore = await client.input.confirm(`Add another ${itemName}?`, false);
  }
}

// src/util/routes/ai-transform.ts
var import_chalk = __toESM(require_source(), 1);

// src/util/routes/parse-conditions.ts
var CONDITION_OPERATORS = [
  "eq",
  "contains",
  "re",
  "exists"
];
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildConditionValue(operator, value) {
  if (operator === "exists")
    return void 0;
  if (operator === "re")
    return value;
  const escapedValue = escapeRegExp(value);
  if (operator === "contains")
    return `.*${escapedValue}.*`;
  return `^${escapedValue}$`;
}
function validateRegexPattern(pattern, context) {
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new Error(
      `Invalid regex in ${context}: "${pattern}". ${e instanceof Error ? e.message : ""}`
    );
  }
}
function parseOperatorValue(valuePart) {
  if (valuePart === "exists") {
    return { operator: "exists", rawValue: "" };
  }
  const eqIdx = valuePart.indexOf("=");
  if (eqIdx === -1)
    return null;
  const maybeOp = valuePart.slice(0, eqIdx);
  if (CONDITION_OPERATORS.includes(maybeOp)) {
    return {
      operator: maybeOp,
      rawValue: valuePart.slice(eqIdx + 1)
    };
  }
  return null;
}
function parseConditions(conditions) {
  return conditions.map(parseCondition);
}
function parseCondition(condition) {
  const parts = condition.split(":");
  if (parts.length < 2) {
    throw new Error(
      `Invalid condition format: "${condition}". Expected format: type:key or type:key:value`
    );
  }
  const type = parts[0].toLowerCase();
  const validTypes = ["header", "cookie", "query", "host"];
  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid condition type: "${type}". Valid types: ${validTypes.join(", ")}`
    );
  }
  if (type === "host") {
    const rawValue = parts.slice(1).join(":");
    if (!rawValue) {
      throw new Error("Host condition requires a value");
    }
    const opResult2 = parseOperatorValue(rawValue);
    if (opResult2) {
      if (opResult2.operator === "exists") {
        throw new Error(
          'Host condition does not support "exists" operator (host always has a value)'
        );
      }
      if (opResult2.operator !== "re" && !opResult2.rawValue) {
        throw new Error(
          `Host condition with "${opResult2.operator}" operator requires a value`
        );
      }
      const compiledValue = buildConditionValue(
        opResult2.operator,
        opResult2.rawValue
      );
      if (compiledValue !== void 0) {
        validateRegexPattern(compiledValue, "host condition");
      }
      return { type: "host", value: compiledValue };
    }
    validateRegexPattern(rawValue, "host condition");
    return { type: "host", value: rawValue };
  }
  const key = parts[1];
  if (!key) {
    throw new Error(`${type} condition requires a key`);
  }
  const valuePart = parts.length > 2 ? parts.slice(2).join(":") : void 0;
  if (valuePart === void 0) {
    return { type, key };
  }
  const opResult = parseOperatorValue(valuePart);
  if (opResult) {
    if (opResult.operator === "exists") {
      return { type, key };
    }
    if (opResult.operator !== "re" && !opResult.rawValue) {
      throw new Error(
        `Condition "${opResult.operator}" operator requires a value after "="`
      );
    }
    const compiledValue = buildConditionValue(
      opResult.operator,
      opResult.rawValue
    );
    if (compiledValue !== void 0) {
      validateRegexPattern(compiledValue, `${type} condition value`);
    }
    return {
      type,
      key,
      ...compiledValue !== void 0 && { value: compiledValue }
    };
  }
  validateRegexPattern(valuePart, `${type} condition value`);
  return {
    type,
    key,
    value: valuePart
  };
}
function formatCondition2(field) {
  if (field.type === "host") {
    return `host:${field.value}`;
  }
  if (field.value) {
    return `${field.type}:${field.key}:${field.value}`;
  }
  return `${field.type}:${field.key}`;
}

// src/util/routes/ai-transform.ts
function generatedRouteToAddInput(generated) {
  const hasConditions = [];
  const missingConditions = [];
  const headers = {};
  const transforms = [];
  let dest;
  let status;
  if (generated.conditions) {
    for (const c of generated.conditions) {
      const compiledValue = c.value !== void 0 ? buildConditionValue(c.operator, c.value) : void 0;
      const field = c.field === "host" ? { type: "host", value: compiledValue ?? c.value ?? "" } : {
        type: c.field,
        key: c.key ?? "",
        ...compiledValue !== void 0 && { value: compiledValue }
      };
      if (c.missing) {
        missingConditions.push(field);
      } else {
        hasConditions.push(field);
      }
    }
  }
  for (const action of generated.actions) {
    switch (action.type) {
      case "rewrite":
        dest = action.dest;
        break;
      case "redirect":
        dest = action.dest;
        status = action.status;
        break;
      case "set-status":
        status = action.status;
        break;
      case "modify": {
        if (!action.headers)
          break;
        if (action.subType === "response-headers") {
          for (const h of action.headers) {
            if (h.op === "set") {
              headers[h.key] = h.value ?? "";
            } else {
              transforms.push({
                type: "response.headers",
                op: h.op,
                target: { key: h.key },
                ...h.op !== "delete" && h.value && { args: h.value }
              });
            }
          }
        } else if (action.subType === "transform-request-header") {
          for (const h of action.headers) {
            transforms.push({
              type: "request.headers",
              op: h.op,
              target: { key: h.key },
              ...h.op !== "delete" && h.value && { args: h.value }
            });
          }
        } else if (action.subType === "transform-request-query") {
          for (const h of action.headers) {
            transforms.push({
              type: "request.query",
              op: h.op,
              target: { key: h.key },
              ...h.op !== "delete" && h.value && { args: h.value }
            });
          }
        }
        break;
      }
    }
  }
  return {
    name: generated.name,
    description: generated.description || void 0,
    srcSyntax: generated.pathCondition.syntax,
    route: {
      src: generated.pathCondition.value,
      ...dest !== void 0 && { dest },
      ...status !== void 0 && { status },
      ...Object.keys(headers).length > 0 && { headers },
      ...transforms.length > 0 && { transforms },
      ...hasConditions.length > 0 && { has: hasConditions },
      ...missingConditions.length > 0 && { missing: missingConditions }
    }
  };
}
function convertRouteToCurrentRoute(generated) {
  return {
    name: generated.name,
    description: generated.description || void 0,
    pathCondition: generated.pathCondition,
    conditions: generated.conditions,
    actions: generated.actions
  };
}
function routingRuleToCurrentRoute(rule) {
  const conditions = [];
  const actions = [];
  if (rule.route.has) {
    for (const c of rule.route.has) {
      conditions.push({
        field: c.type,
        operator: c.value !== void 0 ? "re" : "exists",
        key: c.key,
        value: c.value !== void 0 ? typeof c.value === "string" ? c.value : JSON.stringify(c.value) : void 0,
        missing: false
      });
    }
  }
  if (rule.route.missing) {
    for (const c of rule.route.missing) {
      conditions.push({
        field: c.type,
        operator: c.value !== void 0 ? "re" : "exists",
        key: c.key,
        value: c.value !== void 0 ? typeof c.value === "string" ? c.value : JSON.stringify(c.value) : void 0,
        missing: true
      });
    }
  }
  const isRedirect = rule.route.dest && rule.route.status && REDIRECT_STATUS_CODES.includes(rule.route.status);
  if (isRedirect) {
    actions.push({
      type: "redirect",
      dest: rule.route.dest,
      status: rule.route.status
    });
  } else if (rule.route.dest) {
    actions.push({ type: "rewrite", dest: rule.route.dest });
  } else if (rule.route.status) {
    actions.push({ type: "set-status", status: rule.route.status });
  }
  const responseHeaders = rule.route.headers ? Object.entries(rule.route.headers).map(([key, value]) => ({
    key,
    value,
    op: "set"
  })) : [];
  const allTransforms = rule.route.transforms ?? [];
  const responseHeaderTransforms = allTransforms.filter((t) => t.type === "response.headers").map((t) => ({
    key: typeof t.target.key === "string" ? t.target.key : String(t.target.key),
    value: t.args,
    op: t.op
  }));
  const allResponseHeaders = [...responseHeaders, ...responseHeaderTransforms];
  if (allResponseHeaders.length > 0) {
    actions.push({
      type: "modify",
      subType: "response-headers",
      headers: allResponseHeaders
    });
  }
  const requestHeaders = allTransforms.filter((t) => t.type === "request.headers").map((t) => ({
    key: typeof t.target.key === "string" ? t.target.key : String(t.target.key),
    value: t.args,
    op: t.op
  }));
  if (requestHeaders.length > 0) {
    actions.push({
      type: "modify",
      subType: "transform-request-header",
      headers: requestHeaders
    });
  }
  const requestQuery = allTransforms.filter((t) => t.type === "request.query").map((t) => ({
    key: typeof t.target.key === "string" ? t.target.key : String(t.target.key),
    value: t.args,
    op: t.op
  }));
  if (requestQuery.length > 0) {
    actions.push({
      type: "modify",
      subType: "transform-request-query",
      headers: requestQuery
    });
  }
  return {
    name: rule.name,
    description: rule.description,
    pathCondition: {
      value: rule.route.src,
      syntax: rule.srcSyntax ?? "regex"
    },
    ...conditions.length > 0 && { conditions },
    actions
  };
}
function printGeneratedRoutePreview(generated) {
  output_manager_default.print("\n");
  output_manager_default.print(`  ${import_chalk.default.bold("Generated Route:")}
`);
  output_manager_default.print(`  ${import_chalk.default.cyan("Name:")}         ${generated.name}
`);
  if (generated.description) {
    output_manager_default.print(`  ${import_chalk.default.cyan("Description:")}  ${generated.description}
`);
  }
  output_manager_default.print(
    `  ${import_chalk.default.cyan("Source:")}       ${generated.pathCondition.value}
`
  );
  if (generated.conditions && generated.conditions.length > 0) {
    output_manager_default.print(`  ${import_chalk.default.cyan("Conditions:")}
`);
    for (const c of generated.conditions) {
      const prefix = c.missing ? "does not have" : "has";
      const operatorLabel = c.operator === "eq" ? "equal to" : c.operator === "contains" ? "containing" : c.operator === "re" ? "matching" : "";
      const key = c.key ? ` ${import_chalk.default.cyan(`"${c.key}"`)}` : "";
      const value = c.operator === "exists" || !c.value ? "" : ` ${operatorLabel} ${import_chalk.default.cyan(`"${c.value}"`)}`;
      output_manager_default.print(`    ${import_chalk.default.gray(prefix)} ${c.field}${key}${value}
`);
    }
  }
  for (const action of generated.actions) {
    if (action.type === "rewrite" && action.dest) {
      output_manager_default.print(
        `  ${import_chalk.default.cyan("Action:")}       Rewrite \u2192 ${action.dest}
`
      );
    } else if (action.type === "redirect" && action.dest) {
      output_manager_default.print(
        `  ${import_chalk.default.cyan("Action:")}       Redirect \u2192 ${action.dest} (${action.status})
`
      );
    } else if (action.type === "set-status" && action.status) {
      output_manager_default.print(
        `  ${import_chalk.default.cyan("Action:")}       Set Status ${action.status}
`
      );
    }
  }
  for (const action of generated.actions) {
    if (action.type === "modify" && action.headers) {
      const label = action.subType === "response-headers" ? "Response Headers" : action.subType === "transform-request-header" ? "Request Headers" : "Request Query";
      output_manager_default.print(`  ${import_chalk.default.cyan(`${label}:`)}
`);
      for (const h of action.headers) {
        if (h.op === "delete") {
          output_manager_default.print(`    ${import_chalk.default.yellow(h.op)} ${import_chalk.default.cyan(h.key)}
`);
        } else {
          output_manager_default.print(
            `    ${import_chalk.default.yellow(h.op)} ${import_chalk.default.cyan(h.key)} = ${h.value}
`
          );
        }
      }
    }
  }
  output_manager_default.print("\n");
}

// src/commands/routes/edit-interactive.ts
var import_chalk2 = __toESM(require_source(), 1);
function getPrimaryActionType(route) {
  const { dest, status } = route.route;
  if (dest && status && REDIRECT_STATUS_CODES.includes(status)) {
    return "redirect";
  }
  if (dest)
    return "rewrite";
  if (status)
    return "set-status";
  return null;
}
function getPrimaryActionLabel(route) {
  const actionType = getPrimaryActionType(route);
  switch (actionType) {
    case "rewrite":
      return `Rewrite \u2192 ${route.route.dest}`;
    case "redirect":
      return `Redirect \u2192 ${route.route.dest} (${route.route.status})`;
    case "set-status":
      return `Set Status ${route.route.status}`;
    default:
      return "(none)";
  }
}
function getResponseHeaders(route) {
  const headers = route.route.headers ?? {};
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}
function getTransformsByType(route, type) {
  const transforms = route.route.transforms ?? [];
  return transforms.filter((t) => t.type === type);
}
function printRouteConfig(route) {
  output_manager_default.print("\n");
  output_manager_default.print(`  ${import_chalk2.default.cyan("Name:")}         ${route.name}
`);
  if (route.description) {
    output_manager_default.print(`  ${import_chalk2.default.cyan("Description:")}  ${route.description}
`);
  }
  output_manager_default.print(
    `  ${import_chalk2.default.cyan("Source:")}       ${route.route.src}  ${import_chalk2.default.gray(`(${route.srcSyntax ?? "regex"})`)}
`
  );
  output_manager_default.print(
    `  ${import_chalk2.default.cyan("Status:")}       ${route.enabled === false ? import_chalk2.default.red("Disabled") : import_chalk2.default.green("Enabled")}
`
  );
  const actionLabel = getPrimaryActionLabel(route);
  output_manager_default.print(`  ${import_chalk2.default.cyan("Action:")}       ${actionLabel}
`);
  const hasConds = route.route.has ?? [];
  if (hasConds.length > 0) {
    output_manager_default.print(`
  ${import_chalk2.default.cyan("Has conditions:")}
`);
    for (const c of hasConds) {
      output_manager_default.print(`    ${formatCondition(c)}
`);
    }
  }
  const missingConds = route.route.missing ?? [];
  if (missingConds.length > 0) {
    output_manager_default.print(`
  ${import_chalk2.default.cyan("Does not have conditions:")}
`);
    for (const c of missingConds) {
      output_manager_default.print(`    ${formatCondition(c)}
`);
    }
  }
  const responseHeaders = getResponseHeaders(route);
  if (responseHeaders.length > 0) {
    output_manager_default.print(`
  ${import_chalk2.default.cyan("Response Headers:")}
`);
    for (const h of responseHeaders) {
      output_manager_default.print(`    ${import_chalk2.default.cyan(h.key)} = ${h.value}
`);
    }
  }
  const requestHeaders = getTransformsByType(route, "request.headers");
  if (requestHeaders.length > 0) {
    output_manager_default.print(`
  ${import_chalk2.default.cyan("Request Headers:")}
`);
    for (const t of requestHeaders) {
      output_manager_default.print(`    ${formatTransform(t)}
`);
    }
  }
  const requestQuery = getTransformsByType(route, "request.query");
  if (requestQuery.length > 0) {
    output_manager_default.print(`
  ${import_chalk2.default.cyan("Request Query:")}
`);
    for (const t of requestQuery) {
      output_manager_default.print(`    ${formatTransform(t)}
`);
    }
  }
  output_manager_default.print("\n");
}
function cloneRoute(route) {
  return JSON.parse(JSON.stringify(route));
}
function applyFlagMutations(route, flags) {
  if (flags["--name"] !== void 0) {
    const name = flags["--name"];
    if (name.length > MAX_NAME_LENGTH) {
      return `Name must be ${MAX_NAME_LENGTH} characters or less.`;
    }
    route.name = name;
  }
  if (flags["--description"] !== void 0) {
    const desc = flags["--description"];
    if (desc.length > MAX_DESCRIPTION_LENGTH) {
      return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less.`;
    }
    route.description = desc || void 0;
  }
  if (flags["--src"] !== void 0) {
    route.route.src = stripQuotes(flags["--src"]);
  }
  if (flags["--src-syntax"] !== void 0) {
    const syntax = flags["--src-syntax"];
    if (!VALID_SYNTAXES.includes(syntax)) {
      return `Invalid syntax: "${syntax}". Valid options: ${VALID_SYNTAXES.join(", ")}`;
    }
    route.srcSyntax = syntax;
  }
  const actionFlag = flags["--action"];
  const destFlag = flags["--dest"];
  const statusFlag = flags["--status"];
  const noDest = flags["--no-dest"];
  const noStatus = flags["--no-status"];
  if (actionFlag) {
    if (!VALID_ACTION_TYPES.includes(actionFlag)) {
      return `Invalid action type: "${actionFlag}". Valid types: ${VALID_ACTION_TYPES.join(", ")}`;
    }
    switch (actionFlag) {
      case "rewrite": {
        const dest = destFlag ? stripQuotes(destFlag) : void 0;
        if (!dest)
          return "--action rewrite requires --dest.";
        route.route.dest = dest;
        delete route.route.status;
        break;
      }
      case "redirect": {
        const dest = destFlag ? stripQuotes(destFlag) : void 0;
        if (!dest)
          return "--action redirect requires --dest.";
        if (statusFlag === void 0)
          return `--action redirect requires --status (${REDIRECT_STATUS_CODES.join(", ")}).`;
        if (!REDIRECT_STATUS_CODES.includes(statusFlag))
          return `Invalid redirect status: ${statusFlag}. Must be one of: ${REDIRECT_STATUS_CODES.join(", ")}`;
        route.route.dest = dest;
        route.route.status = statusFlag;
        break;
      }
      case "set-status": {
        if (statusFlag === void 0)
          return "--action set-status requires --status.";
        if (statusFlag < 100 || statusFlag > 599)
          return "Status code must be between 100 and 599.";
        delete route.route.dest;
        route.route.status = statusFlag;
        break;
      }
    }
  } else {
    if (destFlag !== void 0) {
      route.route.dest = stripQuotes(destFlag);
    }
    if (statusFlag !== void 0) {
      route.route.status = statusFlag;
    }
    if (noDest) {
      delete route.route.dest;
    }
    if (noStatus) {
      delete route.route.status;
    }
  }
  if (flags["--clear-conditions"]) {
    route.route.has = [];
    route.route.missing = [];
  }
  if (flags["--clear-headers"]) {
    route.route.headers = {};
  }
  if (flags["--clear-transforms"]) {
    route.route.transforms = [];
  }
  const transformFlags = extractTransformFlags(flags);
  try {
    const { headers, transforms } = collectHeadersAndTransforms(transformFlags);
    if (Object.keys(headers).length > 0) {
      route.route.headers = {
        ...route.route.headers ?? {},
        ...headers
      };
    }
    if (transforms.length > 0) {
      const existing = route.route.transforms ?? [];
      route.route.transforms = [...existing, ...transforms];
    }
  } catch (e) {
    return `Invalid transform format. ${e instanceof Error ? e.message : ""}`;
  }
  const hasFlags = flags["--has"];
  const missingFlags = flags["--missing"];
  try {
    if (hasFlags) {
      const newHas = parseConditions(hasFlags);
      const existingHas = route.route.has ?? [];
      route.route.has = [...existingHas, ...newHas];
    }
    if (missingFlags) {
      const newMissing = parseConditions(missingFlags);
      const existingMissing = route.route.missing ?? [];
      route.route.missing = [...existingMissing, ...newMissing];
    }
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid condition format";
  }
  const totalConditions = (route.route.has ?? []).length + (route.route.missing ?? []).length;
  if (totalConditions > MAX_CONDITIONS) {
    return `Too many conditions: ${totalConditions}. Maximum is ${MAX_CONDITIONS}.`;
  }
  const hasDest = !!route.route.dest;
  const hasStatus = !!route.route.status;
  const hasHeaders = Object.keys(route.route.headers ?? {}).length > 0;
  const hasTransforms = (route.route.transforms ?? []).length > 0;
  if (!hasDest && !hasStatus && !hasHeaders && !hasTransforms) {
    return "This edit would leave the route with no action. Add --action, headers, or transforms.";
  }
  return null;
}
async function runInteractiveEditLoop(client, route) {
  for (; ; ) {
    const hasConds = (route.route.has ?? []).length;
    const missingConds = (route.route.missing ?? []).length;
    const responseHeaders = getAllResponseHeaders(route).length;
    const requestHeaders = getTransformsByType(route, "request.headers").length;
    const requestQuery = getTransformsByType(route, "request.query").length;
    const syntaxLabel = route.srcSyntax === "path-to-regexp" ? "Pattern" : route.srcSyntax === "equals" ? "Exact" : "Regex";
    const descriptionPreview = route.description ? route.description.length > 40 ? route.description.slice(0, 40) + "..." : route.description : "";
    const editChoices = [
      { name: `Name (${route.name})`, value: "name" },
      {
        name: descriptionPreview ? `Description (${descriptionPreview})` : "Description",
        value: "description"
      },
      {
        name: `Source (${syntaxLabel}: ${route.route.src})`,
        value: "source"
      },
      {
        name: `Primary action (${getPrimaryActionLabel(route)})`,
        value: "action"
      },
      {
        name: `Conditions (${hasConds} has, ${missingConds} missing)`,
        value: "conditions"
      },
      {
        name: `Response Headers (${responseHeaders})`,
        value: "response-headers"
      },
      {
        name: `Request Headers (${requestHeaders})`,
        value: "request-headers"
      },
      {
        name: `Request Query (${requestQuery})`,
        value: "request-query"
      },
      { name: "Done - save changes", value: "done" }
    ];
    const choice = await client.input.select({
      message: "What would you like to edit?",
      choices: editChoices,
      pageSize: editChoices.length,
      loop: false
    });
    switch (choice) {
      case "name":
        await editName(client, route);
        break;
      case "description":
        await editDescription(client, route);
        break;
      case "source":
        await editSource(client, route);
        break;
      case "action":
        await editPrimaryAction(client, route);
        break;
      case "conditions":
        await editConditions(client, route);
        break;
      case "response-headers":
        await editResponseHeaders(client, route);
        break;
      case "request-headers":
        await editTransformsByType(
          client,
          route,
          "request.headers",
          "request-header"
        );
        break;
      case "request-query":
        await editTransformsByType(
          client,
          route,
          "request.query",
          "request-query"
        );
        break;
      case "done":
        break;
    }
    if (choice === "done") {
      const hasDest = !!route.route.dest;
      const hasStatus = !!route.route.status;
      const hasHeaders = Object.keys(route.route.headers ?? {}).length > 0;
      const hasTransforms = (route.route.transforms ?? []).length > 0;
      if (!hasDest && !hasStatus && !hasHeaders && !hasTransforms) {
        output_manager_default.warn(
          "Route has no action (no destination, status, or headers). Add an action before saving."
        );
        continue;
      }
      break;
    }
  }
}
async function editName(client, route) {
  const name = await client.input.text({
    message: `Name (current: ${route.name}):`,
    validate: (val) => {
      if (!val)
        return "Route name is required";
      if (val.length > MAX_NAME_LENGTH)
        return `Name must be ${MAX_NAME_LENGTH} characters or less`;
      return true;
    }
  });
  route.name = name;
}
async function editDescription(client, route) {
  const desc = await client.input.text({
    message: `Description${route.description ? ` (current: ${route.description})` : ""}:`,
    validate: (val) => val && val.length > MAX_DESCRIPTION_LENGTH ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` : true
  });
  route.description = desc || void 0;
}
async function editSource(client, route) {
  const syntaxChoice = await client.input.select({
    message: `Path syntax (current: ${route.srcSyntax ?? "regex"}):`,
    choices: [
      {
        name: "Path pattern (e.g., /api/:version/users/:id)",
        value: "path-to-regexp"
      },
      { name: "Exact match (e.g., /about)", value: "equals" },
      { name: "Regular expression (e.g., ^/api/(.*)$)", value: "regex" }
    ]
  });
  route.srcSyntax = syntaxChoice;
  const src = await client.input.text({
    message: `Path pattern (current: ${route.route.src}):`,
    validate: (val) => {
      if (!val)
        return "Path pattern is required";
      return true;
    }
  });
  route.route.src = src;
}
async function editPrimaryAction(client, route) {
  const currentType = getPrimaryActionType(route);
  const choices = [];
  if (currentType === "rewrite" || currentType === "redirect") {
    choices.push({ name: "Change destination", value: "change-dest" });
  }
  if (currentType === "redirect" || currentType === "set-status") {
    choices.push({ name: "Change status code", value: "change-status" });
  }
  if (currentType !== "rewrite") {
    choices.push({ name: "Switch to Rewrite", value: "switch-rewrite" });
  }
  if (currentType !== "redirect") {
    choices.push({ name: "Switch to Redirect", value: "switch-redirect" });
  }
  if (currentType !== "set-status") {
    choices.push({
      name: "Switch to Set Status Code",
      value: "switch-set-status"
    });
  }
  if (currentType) {
    choices.push({
      name: "Remove primary action",
      value: "remove"
    });
  } else {
    choices.push({ name: "Add Rewrite", value: "switch-rewrite" });
    choices.push({ name: "Add Redirect", value: "switch-redirect" });
    choices.push({ name: "Add Set Status Code", value: "switch-set-status" });
  }
  choices.push({ name: "Back", value: "back" });
  const action = await client.input.select({
    message: `Primary action (current: ${getPrimaryActionLabel(route)}):`,
    choices
  });
  const flags = {};
  switch (action) {
    case "change-dest": {
      const dest = await client.input.text({
        message: `Destination (current: ${route.route.dest}):`,
        validate: (val) => val ? true : "Destination is required"
      });
      route.route.dest = dest;
      break;
    }
    case "change-status": {
      if (currentType === "redirect") {
        const status = await client.input.select({
          message: `Status code (current: ${route.route.status}):`,
          choices: [
            { name: "307 - Temporary Redirect", value: 307 },
            { name: "308 - Permanent Redirect", value: 308 },
            { name: "301 - Moved Permanently", value: 301 },
            { name: "302 - Found", value: 302 },
            { name: "303 - See Other", value: 303 }
          ]
        });
        route.route.status = status;
      } else {
        const statusCode = await client.input.text({
          message: `Status code (current: ${route.route.status}):`,
          validate: (val) => {
            const num = parseInt(val, 10);
            if (isNaN(num) || num < 100 || num > 599) {
              return "Status code must be between 100 and 599";
            }
            return true;
          }
        });
        route.route.status = parseInt(statusCode, 10);
      }
      break;
    }
    case "switch-rewrite": {
      await collectActionDetails(client, "rewrite", flags);
      route.route.dest = flags["--dest"];
      delete route.route.status;
      break;
    }
    case "switch-redirect": {
      await collectActionDetails(client, "redirect", flags);
      route.route.dest = flags["--dest"];
      route.route.status = flags["--status"];
      break;
    }
    case "switch-set-status": {
      await collectActionDetails(client, "set-status", flags);
      delete route.route.dest;
      route.route.status = flags["--status"];
      break;
    }
    case "remove": {
      delete route.route.dest;
      delete route.route.status;
      break;
    }
  }
}
async function editConditions(client, route) {
  for (; ; ) {
    const hasConds = route.route.has ?? [];
    const missingConds = route.route.missing ?? [];
    if (hasConds.length > 0 || missingConds.length > 0) {
      output_manager_default.print("\n");
      if (hasConds.length > 0) {
        output_manager_default.print(`  ${import_chalk2.default.cyan("Has conditions:")}
`);
        hasConds.forEach((c, i) => {
          output_manager_default.print(
            `    ${import_chalk2.default.gray(`${i + 1}.`)} ${formatCondition(c)}
`
          );
        });
      }
      if (missingConds.length > 0) {
        output_manager_default.print(`  ${import_chalk2.default.cyan("Does not have conditions:")}
`);
        missingConds.forEach((c, i) => {
          output_manager_default.print(
            `    ${import_chalk2.default.gray(`${hasConds.length + i + 1}.`)} ${formatCondition(c)}
`
          );
        });
      }
      output_manager_default.print("\n");
    } else {
      output_manager_default.print("\n  No conditions set.\n\n");
    }
    const choices = [];
    if (hasConds.length > 0 || missingConds.length > 0) {
      choices.push({ name: "Remove a condition", value: "remove" });
    }
    choices.push({ name: "Add a new condition", value: "add" });
    choices.push({ name: "Back", value: "back" });
    const action = await client.input.select({
      message: "Conditions:",
      choices
    });
    if (action === "back")
      break;
    if (action === "remove") {
      const allConds = [
        ...hasConds.map((c, i) => ({
          label: `[has] ${formatCondition(c)}`,
          idx: i,
          kind: "has"
        })),
        ...missingConds.map((c, i) => ({
          label: `[does not have] ${formatCondition(c)}`,
          idx: i,
          kind: "missing"
        }))
      ];
      const toRemove = await client.input.select({
        message: "Select condition to remove:",
        choices: [
          ...allConds.map((c, i) => ({
            name: c.label,
            value: i
          })),
          { name: "Cancel", value: -1 }
        ]
      });
      if (toRemove !== -1) {
        const selected = allConds[toRemove];
        if (selected.kind === "has") {
          hasConds.splice(selected.idx, 1);
          route.route.has = hasConds;
        } else {
          missingConds.splice(selected.idx, 1);
          route.route.missing = missingConds;
        }
      }
    }
    if (action === "add") {
      const existingHasStrings = hasConds.map(
        (c) => formatCondition2(c)
      );
      const existingMissingStrings = missingConds.map(
        (c) => formatCondition2(c)
      );
      const tempFlags = {
        "--has": existingHasStrings.length > 0 ? existingHasStrings : void 0,
        "--missing": existingMissingStrings.length > 0 ? existingMissingStrings : void 0
      };
      const hasBefore = existingHasStrings.length;
      const missingBefore = existingMissingStrings.length;
      await collectInteractiveConditions(client, tempFlags);
      const allHas = tempFlags["--has"] || [];
      const allMissing = tempFlags["--missing"] || [];
      const newHas = allHas.slice(hasBefore);
      const newMissing = allMissing.slice(missingBefore);
      if (newHas.length > 0) {
        const parsed = parseConditions(newHas);
        const existing = route.route.has ?? [];
        route.route.has = [...existing, ...parsed];
      }
      if (newMissing.length > 0) {
        const parsed = parseConditions(newMissing);
        const existing = route.route.missing ?? [];
        route.route.missing = [...existing, ...parsed];
      }
      break;
    }
  }
}
function getAllResponseHeaders(route) {
  const items = [];
  for (const [key, value] of Object.entries(route.route.headers ?? {})) {
    items.push({ op: "set", key, value, source: "headers" });
  }
  const transforms = route.route.transforms ?? [];
  for (const t of transforms) {
    if (t.type === "response.headers") {
      items.push({
        op: t.op,
        key: typeof t.target.key === "string" ? t.target.key : JSON.stringify(t.target.key),
        value: typeof t.args === "string" ? t.args : void 0,
        source: "transform"
      });
    }
  }
  return items;
}
function formatResponseHeaderItem(item) {
  if (item.op === "delete") {
    return `${import_chalk2.default.yellow(item.op)} ${import_chalk2.default.cyan(item.key)}`;
  }
  return `${import_chalk2.default.yellow(item.op)} ${import_chalk2.default.cyan(item.key)} = ${item.value}`;
}
async function editResponseHeaders(client, route) {
  for (; ; ) {
    const allHeaders = getAllResponseHeaders(route);
    if (allHeaders.length > 0) {
      output_manager_default.print("\n");
      output_manager_default.print(`  ${import_chalk2.default.cyan("Response Headers:")}
`);
      allHeaders.forEach((h, i) => {
        output_manager_default.print(
          `    ${import_chalk2.default.gray(`${i + 1}.`)} ${formatResponseHeaderItem(h)}
`
        );
      });
      output_manager_default.print("\n");
    } else {
      output_manager_default.print("\n  No response headers set.\n\n");
    }
    const choices = [];
    if (allHeaders.length > 0) {
      choices.push({ name: "Remove a response header", value: "remove" });
    }
    choices.push({ name: "Add a response header", value: "add" });
    choices.push({ name: "Back", value: "back" });
    const action = await client.input.select({
      message: "Response Headers:",
      choices
    });
    if (action === "back")
      break;
    if (action === "remove") {
      const toRemove = await client.input.select({
        message: "Select response header to remove:",
        choices: [
          ...allHeaders.map((h, i) => ({
            name: h.op === "delete" ? `${h.op} ${h.key}` : `${h.op} ${h.key} = ${h.value}`,
            value: i
          })),
          { name: "Cancel", value: -1 }
        ]
      });
      if (toRemove !== -1) {
        const item = allHeaders[toRemove];
        if (item.source === "headers") {
          const currentHeaders = { ...route.route.headers ?? {} };
          delete currentHeaders[item.key];
          route.route.headers = currentHeaders;
        } else {
          const transforms = route.route.transforms ?? [];
          const idx = transforms.findIndex(
            (t) => t.type === "response.headers" && t.op === item.op && (typeof t.target.key === "string" ? t.target.key : JSON.stringify(t.target.key)) === item.key
          );
          if (idx !== -1) {
            transforms.splice(idx, 1);
            route.route.transforms = transforms;
          }
        }
      }
    }
    if (action === "add") {
      const tempFlags = {};
      await collectInteractiveHeaders(client, "response", tempFlags);
      const setHeaders = tempFlags["--set-response-header"] || [];
      for (const h of setHeaders) {
        const eqIdx = h.indexOf("=");
        if (eqIdx !== -1) {
          const key = h.slice(0, eqIdx).trim();
          const value = h.slice(eqIdx + 1);
          route.route.headers = {
            ...route.route.headers ?? {},
            [key]: value
          };
        }
      }
      const appendHeaders = tempFlags["--append-response-header"] || [];
      const deleteHeaders = tempFlags["--delete-response-header"] || [];
      const existing = route.route.transforms ?? [];
      const newTransforms = [];
      for (const h of appendHeaders) {
        const eqIdx = h.indexOf("=");
        if (eqIdx !== -1) {
          newTransforms.push({
            type: "response.headers",
            op: "append",
            target: { key: h.slice(0, eqIdx).trim() },
            args: h.slice(eqIdx + 1)
          });
        }
      }
      for (const key of deleteHeaders) {
        newTransforms.push({
          type: "response.headers",
          op: "delete",
          target: { key: key.trim() }
        });
      }
      if (newTransforms.length > 0) {
        route.route.transforms = [...existing, ...newTransforms];
      }
      break;
    }
  }
}
async function editTransformsByType(client, route, transformType, headerType) {
  const label = transformType === "request.headers" ? "Request Headers" : "Request Query";
  const itemName = transformType === "request.headers" ? "request header" : "query parameter";
  for (; ; ) {
    const allTransforms = route.route.transforms ?? [];
    const matching = allTransforms.filter((t) => t.type === transformType);
    if (matching.length > 0) {
      output_manager_default.print("\n");
      output_manager_default.print(`  ${import_chalk2.default.cyan(`${label}:`)}
`);
      matching.forEach((t, i) => {
        output_manager_default.print(
          `    ${import_chalk2.default.gray(`${i + 1}.`)} ${formatTransform(t)}
`
        );
      });
      output_manager_default.print("\n");
    } else {
      output_manager_default.print(`
  No ${label.toLowerCase()} set.

`);
    }
    const choices = [];
    if (matching.length > 0) {
      choices.push({ name: `Remove a ${itemName}`, value: "remove" });
    }
    choices.push({ name: `Add a ${itemName}`, value: "add" });
    choices.push({ name: "Back", value: "back" });
    const action = await client.input.select({
      message: `${label}:`,
      choices
    });
    if (action === "back")
      break;
    if (action === "remove") {
      const toRemove = await client.input.select({
        message: `Select ${itemName} to remove:`,
        choices: [
          ...matching.map((t, i) => ({
            name: formatTransform(t),
            value: i
          })),
          { name: "Cancel", value: -1 }
        ]
      });
      if (toRemove !== -1) {
        let matchIdx = 0;
        const removeIdx = allTransforms.findIndex((t) => {
          if (t.type === transformType) {
            if (matchIdx === toRemove)
              return true;
            matchIdx++;
          }
          return false;
        });
        if (removeIdx !== -1) {
          allTransforms.splice(removeIdx, 1);
          route.route.transforms = allTransforms;
        }
      }
    }
    if (action === "add") {
      const tempFlags = {};
      await collectInteractiveHeaders(client, headerType, tempFlags);
      const tfFlags = extractTransformFlags(tempFlags);
      const { transforms } = collectHeadersAndTransforms(tfFlags);
      if (transforms.length > 0) {
        route.route.transforms = [...allTransforms, ...transforms];
      }
      break;
    }
  }
}

export {
  parseConditions,
  populateRouteEnv,
  generateRoute,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_CONDITIONS,
  VALID_SYNTAXES,
  REDIRECT_STATUS_CODES,
  ALL_ACTION_CHOICES,
  stripQuotes,
  extractTransformFlags,
  collectHeadersAndTransforms,
  hasAnyTransformFlags,
  validateActionFlags,
  collectActionDetails,
  collectInteractiveConditions,
  generatedRouteToAddInput,
  convertRouteToCurrentRoute,
  routingRuleToCurrentRoute,
  printGeneratedRoutePreview,
  printRouteConfig,
  cloneRoute,
  applyFlagMutations,
  runInteractiveEditLoop
};
