import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  require_ms
} from "./chunk-CO5D46AG.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/time-utils.ts
var import_ms = __toESM(require_ms(), 1);
function parseTimeFlag(input) {
  const milliseconds = (0, import_ms.default)(input);
  if (milliseconds !== void 0) {
    return new Date(Date.now() - milliseconds);
  }
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid time format "${input}". Use relative (1h, 30m, 2d, 1w) or ISO 8601 datetime.`
    );
  }
  return date;
}
function resolveTimeRange(since = "1h", until) {
  const startTime = parseTimeFlag(since);
  const endTime = until ? parseTimeFlag(until) : /* @__PURE__ */ new Date();
  return { startTime, endTime };
}

// src/util/command-validation.ts
function validateAllProjectMutualExclusivity(all, project) {
  if (all && project) {
    return {
      valid: false,
      code: "MUTUAL_EXCLUSIVITY",
      message: "Cannot specify both --all and --project. Use one or the other."
    };
  }
  return { valid: true };
}
function validateTimeBound(input) {
  if (!input) {
    return { valid: true, value: void 0 };
  }
  try {
    return { valid: true, value: parseTimeFlag(input) };
  } catch (err) {
    return {
      valid: false,
      code: "INVALID_TIME",
      message: err.message
    };
  }
}
function validateTimeOrder(since, until) {
  if (since && until && since.getTime() > until.getTime()) {
    return {
      valid: false,
      code: "INVALID_TIME_RANGE",
      message: "`--since` must be earlier than `--until`."
    };
  }
  return { valid: true };
}
function normalizeRepeatableStringFilters(filters) {
  if (!filters || filters.length === 0) {
    return [];
  }
  const normalized = filters.flatMap((filter) => filter.split(",")).map((filter) => filter.trim()).filter(Boolean);
  return [...new Set(normalized)];
}
function validateIntegerRangeWithDefault(value, opts) {
  if (value === void 0) {
    return { valid: true, value: opts.defaultValue };
  }
  if (Number.isNaN(value)) {
    return {
      valid: false,
      code: "INVALID_LIMIT",
      message: `Please provide a number for flag \`${opts.flag}\`.`
    };
  }
  if (!Number.isInteger(value) || value < opts.min || value > opts.max) {
    return {
      valid: false,
      code: "INVALID_LIMIT",
      message: `\`${opts.flag}\` must be an integer between ${opts.min} and ${opts.max}.`
    };
  }
  return { valid: true, value };
}
function validateOptionalIntegerRange(value, opts) {
  if (value === void 0) {
    return { valid: true, value: void 0 };
  }
  if (Number.isNaN(value)) {
    return {
      valid: false,
      code: opts.code || "INVALID_LIMIT",
      message: `Please provide a number for flag \`${opts.flag}\`.`
    };
  }
  if (!Number.isInteger(value) || value < opts.min || value > opts.max) {
    return {
      valid: false,
      code: opts.code || "INVALID_LIMIT",
      message: `\`${opts.flag}\` must be an integer between ${opts.min} and ${opts.max}.`
    };
  }
  return { valid: true, value };
}
function formatJsonError(code, message) {
  return `${JSON.stringify({ error: { code, message } }, null, 2)}
`;
}
function writeJsonError(client, code, message) {
  client.stdout.write(formatJsonError(code, message));
}
function outputError(client, jsonOutput, code, message) {
  if (jsonOutput) {
    writeJsonError(client, code, message);
  } else {
    output_manager_default.error(message);
  }
  return 1;
}
function handleValidationError(result, jsonOutput, client) {
  return outputError(client, jsonOutput, result.code, result.message);
}

export {
  resolveTimeRange,
  validateAllProjectMutualExclusivity,
  validateTimeBound,
  validateTimeOrder,
  normalizeRepeatableStringFilters,
  validateIntegerRangeWithDefault,
  validateOptionalIntegerRange,
  outputError,
  handleValidationError
};
