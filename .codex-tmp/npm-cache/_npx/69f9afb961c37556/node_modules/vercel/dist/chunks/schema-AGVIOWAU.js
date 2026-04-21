import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  fetchMetricDetailOrExit,
  fetchMetricListOrExit,
  formatErrorJson
} from "./chunk-GLDQ23LD.js";
import {
  indent_default
} from "./chunk-A3NYPUKZ.js";
import {
  formatTable
} from "./chunk-G6RXZLQ2.js";
import {
  getScope
} from "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  schemaSubcommand
} from "./chunk-BHDZCUTT.js";
import "./chunk-GE6G37P4.js";
import {
  require_pluralize
} from "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import "./chunk-XKHLPA6V.js";
import "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/commands/metrics/schema.ts
var import_pluralize = __toESM(require_pluralize(), 1);
async function schema(client, telemetry) {
  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(schemaSubcommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }
  const flags = parsedArgs.flags;
  const positionalArgs = parsedArgs.args.slice(1);
  const positionalMetric = positionalArgs[0] === "schema" ? positionalArgs[1] : positionalArgs[0];
  const formatResult = validateJsonOutput(flags);
  if (!formatResult.valid) {
    output_manager_default.error(formatResult.error);
    return 1;
  }
  const jsonOutput = formatResult.jsonOutput;
  const metric = positionalMetric;
  telemetry.trackCliArgumentMetricId(metric);
  telemetry.trackCliOptionFormat(flags["--format"]);
  const { team } = await getScope(client);
  if (!team) {
    const message = "The metrics schema API request was not authorized. Run `vercel login` to authenticate and `vercel switch` to select a team, then try again.";
    if (jsonOutput) {
      client.stdout.write(formatErrorJson("SCHEMA_UNAUTHORIZED", message));
    } else {
      output_manager_default.error(message);
    }
    return 1;
  }
  if (metric) {
    const detailOrExitCode = await fetchMetricDetailOrExit(
      client,
      team.id,
      metric,
      jsonOutput
    );
    if (typeof detailOrExitCode === "number") {
      return detailOrExitCode;
    }
    if (jsonOutput) {
      client.stdout.write(JSON.stringify(detailOrExitCode, null, 2));
      return 0;
    }
    output_manager_default.log(`Metric: ${metric}`);
    const metricsTable = formatMetricsTable(detailOrExitCode);
    if (metricsTable) {
      output_manager_default.print(metricsTable);
      output_manager_default.print("\n");
    }
    return 0;
  }
  const metricsOrExitCode = await fetchMetricListOrExit(
    client,
    team.id,
    jsonOutput
  );
  if (typeof metricsOrExitCode === "number") {
    return metricsOrExitCode;
  }
  if (jsonOutput) {
    client.stdout.write(JSON.stringify(metricsOrExitCode, null, 2));
  } else {
    output_manager_default.log(`${(0, import_pluralize.default)("Metric", metricsOrExitCode.length, true)} found`);
    output_manager_default.print(formatMetricListTable(metricsOrExitCode));
    output_manager_default.print("\n");
  }
  return 0;
}
function formatMetricListTable(metrics) {
  return indent_default(
    formatTable(
      ["Metric", "Description"],
      ["l", "l"],
      [{ rows: metrics.map((metric) => [metric.id, metric.description]) }]
    ),
    1
  );
}
function formatMetricsTable(metrics) {
  if (metrics.length === 0) {
    return null;
  }
  const dimensionsByMetric = metrics.map(
    (metric) => metric.dimensions.map((dimension) => dimension.name)
  );
  const sharedDimensions = dimensionsByMetric[0].filter(
    (dimension) => dimensionsByMetric.every(
      (metricDimensions) => metricDimensions.includes(dimension)
    )
  );
  const rows = metrics.map((metric) => {
    const extraDimensions = metric.dimensions.map((dimension) => dimension.name).filter((dimension) => !sharedDimensions.includes(dimension)).map((dimension) => `+${dimension}`);
    const aggregations = metric.aggregations.map(
      (aggregation) => aggregation === metric.defaultAggregation ? `${aggregation} (default)` : aggregation
    ).join(", ");
    return {
      metric: metric.id,
      description: metric.description,
      unit: metric.unit,
      aggregations,
      extraDimensions
    };
  });
  const hasExtraDimensions = rows.some((row) => row.extraDimensions.length > 0);
  const tableHeaders = hasExtraDimensions ? ["Metric", "Description", "Unit", "Aggregations", "Dimensions"] : ["Metric", "Description", "Unit", "Aggregations"];
  const tableRows = rows.map(
    (row) => hasExtraDimensions ? [
      row.metric,
      row.description,
      row.unit,
      row.aggregations,
      row.extraDimensions.join(", ") || "\u2014"
    ] : [row.metric, row.description, row.unit, row.aggregations]
  );
  const sharedDimensionsLine = sharedDimensions.length > 0 ? metrics.length === 1 ? `Dimensions:
  ${sharedDimensions.join(", ")}` : `Shared dimensions:
  ${sharedDimensions.join(", ")}` : null;
  const table = indent_default(
    formatTable(
      tableHeaders,
      hasExtraDimensions ? ["l", "l", "l", "l", "l"] : ["l", "l", "l", "l"],
      [{ rows: tableRows }]
    ),
    1
  );
  return sharedDimensionsLine ? `
${table}

${sharedDimensionsLine}` : `
${table}`;
}
export {
  schema as default
};
