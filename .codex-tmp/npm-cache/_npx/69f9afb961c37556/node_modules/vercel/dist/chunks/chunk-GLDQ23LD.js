import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  isAPIError
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";

// src/commands/metrics/output.ts
function getRollupColumnName(metric, aggregation) {
  return `${metric.replace(/\./g, "_")}_${aggregation}`;
}
function formatQueryJson(query, response) {
  return JSON.stringify(
    {
      query,
      summary: response.summary ?? [],
      data: response.data ?? [],
      statistics: response.statistics ?? {}
    },
    null,
    2
  );
}
function formatErrorJson(code, message, allowedValues) {
  const error = {
    code,
    message
  };
  if (allowedValues && allowedValues.length > 0) {
    error.allowedValues = allowedValues;
  }
  return JSON.stringify({ error }, null, 2);
}
function handleApiError(err, jsonOutput, client, overrides = {}) {
  let code;
  let message;
  const override = overrides[err.status];
  if (override) {
    code = override.code || err.code || "BAD_REQUEST";
    message = override.message;
  } else {
    switch (err.status) {
      case 402:
        code = err.code || "PAYMENT_REQUIRED";
        message = err.serverMessage || "This feature requires an Observability Plus subscription. Upgrade at https://vercel.com/dashboard/settings/billing";
        break;
      case 429:
        code = err.code || "RATE_LIMITED";
        message = err.serverMessage || "You have reached the metrics query rate limit. Please wait and try again. If you need a higher limit, request one from your Vercel account team.";
        break;
      case 403:
        code = "FORBIDDEN";
        message = "You do not have permission to query metrics for this project/team.";
        break;
      case 500:
        code = "INTERNAL_ERROR";
        message = "An internal error occurred. Please try again later.";
        break;
      case 504:
        code = "TIMEOUT";
        message = "The query timed out. Try a shorter time range or fewer groups.";
        break;
      case 400:
        code = err.code || "BAD_REQUEST";
        message = err.serverMessage || `API error (${err.status})`;
        break;
      default:
        code = err.code || "BAD_REQUEST";
        message = err.serverMessage || `API error (${err.status})`;
    }
  }
  if (jsonOutput) {
    client.stdout.write(formatErrorJson(code, message, err.allowedValues));
  } else {
    output_manager_default.error(message);
    if (err.allowedValues && err.allowedValues.length > 0) {
      output_manager_default.print(`
Available values: ${err.allowedValues.join(", ")}
`);
    }
  }
  return 1;
}

// src/commands/metrics/schema-api.ts
function toMetricDetail(metric) {
  return {
    id: metric.id,
    description: metric.description,
    dimensions: metric.dimensions,
    unit: metric.unit,
    aggregations: metric.aggregations,
    defaultAggregation: metric.defaultAggregation
  };
}
function getDefaultAggregation(detail, metricId) {
  return detail.find((metric) => metric.id === metricId)?.defaultAggregation;
}
async function fetchMetricList(client, accountId) {
  const { metrics } = await client.fetch(
    "/v2/observability/schema",
    { accountId }
  );
  return metrics;
}
async function fetchMetricDetail(client, accountId, metricId) {
  const detail = await client.fetch(
    `/v2/observability/schema/${encodeURIComponent(metricId)}`,
    { accountId }
  );
  return detail.map(toMetricDetail);
}
async function fetchMetricListOrExit(client, accountId, jsonOutput) {
  try {
    return await fetchMetricList(client, accountId);
  } catch (err) {
    if (isAPIError(err)) {
      return handleApiError(err, jsonOutput, client, {
        401: {
          code: "SCHEMA_UNAUTHORIZED",
          message: "The metrics schema API request was not authorized. Run `vercel login` to authenticate and `vercel switch` to select a team, then try again."
        },
        403: {
          code: "SCHEMA_UNAUTHORIZED",
          message: "The metrics schema API request was not authorized. Run `vercel login` to authenticate and `vercel switch` to select a team, then try again."
        }
      });
    }
    const message = err instanceof Error ? `Failed to fetch metrics schema: ${err.message}` : `Failed to fetch metrics schema: ${String(err)}`;
    if (jsonOutput) {
      client.stdout.write(formatErrorJson("SCHEMA_FETCH_FAILED", message));
    } else {
      output_manager_default.error(message);
    }
    return 1;
  }
}
async function fetchMetricDetailOrExit(client, accountId, metricId, jsonOutput) {
  try {
    return await fetchMetricDetail(client, accountId, metricId);
  } catch (err) {
    if (isAPIError(err)) {
      return handleApiError(err, jsonOutput, client, {
        401: {
          code: "SCHEMA_UNAUTHORIZED",
          message: "The metrics schema API request was not authorized. Run `vercel login` to authenticate and `vercel switch` to select a team, then try again."
        },
        403: {
          code: "SCHEMA_UNAUTHORIZED",
          message: "The metrics schema API request was not authorized. Run `vercel login` to authenticate and `vercel switch` to select a team, then try again."
        }
      });
    }
    const message = err instanceof Error ? `Failed to fetch metrics schema: ${err.message}` : `Failed to fetch metrics schema: ${String(err)}`;
    if (jsonOutput) {
      client.stdout.write(formatErrorJson("SCHEMA_FETCH_FAILED", message));
    } else {
      output_manager_default.error(message);
    }
    return 1;
  }
}

export {
  getRollupColumnName,
  formatQueryJson,
  formatErrorJson,
  handleApiError,
  getDefaultAggregation,
  fetchMetricListOrExit,
  fetchMetricDetailOrExit
};
