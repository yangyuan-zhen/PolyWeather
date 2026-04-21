import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  fetchMetricDetailOrExit,
  formatErrorJson,
  formatQueryJson,
  getDefaultAggregation,
  getRollupColumnName,
  handleApiError
} from "./chunk-GLDQ23LD.js";
import {
  resolveTimeRange,
  validateAllProjectMutualExclusivity
} from "./chunk-HTOH3MSD.js";
import {
  indent_default
} from "./chunk-A3NYPUKZ.js";
import {
  getScope
} from "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  metricsCommand
} from "./chunk-BHDZCUTT.js";
import {
  table
} from "./chunk-GE6G37P4.js";
import {
  getLinkedProject,
  getProjectByNameOrId
} from "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import "./chunk-XKHLPA6V.js";
import {
  require_ms
} from "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  ProjectNotFound,
  isAPIError
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/commands/metrics/validation.ts
function validateMutualExclusivity(all, project) {
  return validateAllProjectMutualExclusivity(all, project);
}
function validateRequiredMetric(metric) {
  if (metric) {
    return { valid: true, value: metric };
  }
  return {
    valid: false,
    code: "MISSING_METRIC",
    message: "Missing required metric. Specify the metric to query.\n\nRun 'vercel metrics schema' to see available metrics."
  };
}

// src/commands/metrics/text-output.ts
var import_chalk = __toESM(require_source(), 1);

// src/commands/metrics/time-utils.ts
var import_ms = __toESM(require_ms(), 1);
var MINUTE_MS = 60 * 1e3;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
function toGranularityDuration(input) {
  const milliseconds = (0, import_ms.default)(input);
  if (milliseconds === void 0) {
    throw new Error(
      `Invalid granularity format "${input}". Use 1m, 5m, 15m, 1h, 4h, 1d.`
    );
  }
  if (milliseconds >= DAY_MS) {
    return { days: milliseconds / DAY_MS };
  }
  if (milliseconds >= HOUR_MS) {
    return { hours: milliseconds / HOUR_MS };
  }
  return { minutes: milliseconds / MINUTE_MS };
}
function toGranularityMs(input) {
  const milliseconds = (0, import_ms.default)(input);
  if (milliseconds === void 0) {
    throw new Error(`Invalid granularity format "${input}".`);
  }
  return milliseconds;
}
var GRANULARITY_THRESHOLDS = [
  [1 * HOUR_MS, "1m", "1m"],
  // ≤1h
  [2 * HOUR_MS, "5m", "5m"],
  // ≤2h
  [12 * HOUR_MS, "15m", "5m"],
  // ≤12h
  [3 * DAY_MS, "1h", "1h"],
  // ≤3d
  [30 * DAY_MS, "4h", "4h"]
  // ≤30d
];
var FALLBACK_GRANULARITY = "1d";
function getAutoGranularity(rangeMs) {
  for (const [maxRange, defaultG] of GRANULARITY_THRESHOLDS) {
    if (rangeMs <= maxRange) {
      return defaultG;
    }
  }
  return FALLBACK_GRANULARITY;
}
function getMinGranularity(rangeMs) {
  for (const [maxRange, , minG] of GRANULARITY_THRESHOLDS) {
    if (rangeMs <= maxRange) {
      return minG;
    }
  }
  return FALLBACK_GRANULARITY;
}
function computeGranularity(rangeMs, explicit) {
  if (!explicit) {
    const auto = getAutoGranularity(rangeMs);
    return {
      duration: toGranularityDuration(auto),
      adjusted: false
    };
  }
  const minG = getMinGranularity(rangeMs);
  const explicitMs = toGranularityMs(explicit);
  const minMs = toGranularityMs(minG);
  if (explicitMs < minMs) {
    const rangeDays = Math.round(rangeMs / DAY_MS);
    const rangeHours = Math.round(rangeMs / HOUR_MS);
    const rangeLabel = rangeDays >= 1 ? `${rangeDays}-day` : `${rangeHours}-hour`;
    return {
      duration: toGranularityDuration(minG),
      adjusted: true,
      notice: `Granularity adjusted from ${explicit} to ${minG} for a ${rangeLabel} time range.`
    };
  }
  return {
    duration: toGranularityDuration(explicit),
    adjusted: false
  };
}
function roundTimeBoundaries(start, end, granularityMs) {
  const flooredStart = new Date(
    Math.floor(start.getTime() / granularityMs) * granularityMs
  );
  const ceiledEnd = new Date(
    Math.ceil(end.getTime() / granularityMs) * granularityMs
  );
  return { start: flooredStart, end: ceiledEnd };
}
function toGranularityMsFromDuration(duration) {
  if ("minutes" in duration) {
    return duration.minutes * MINUTE_MS;
  }
  if ("hours" in duration) {
    return duration.hours * HOUR_MS;
  }
  return duration.days * DAY_MS;
}

// src/commands/metrics/text-output.ts
var GROUP_KEY_DELIMITER = "";
var MAX_SPARKLINE_LENGTH = 120;
var COUNT_UNITS = /* @__PURE__ */ new Set(["count", "usd", "us dollars", "dollars"]);
var DURATION_UNITS = /* @__PURE__ */ new Set(["milliseconds", "seconds"]);
var BYTES_UNITS = /* @__PURE__ */ new Set([
  "bytes",
  "megabytes",
  "gigabyte hour",
  "gigabyte_hour",
  "gigabyte hours",
  "gigabyte_hours"
]);
var RATIO_UNITS = /* @__PURE__ */ new Set(["ratio", "percent"]);
var BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
var MISSING_CHAR = "\xB7";
function normalizeUnit(unit) {
  return unit.trim().toLowerCase().replace(/[_\s]+/g, " ");
}
function toGroupKey(groupValues) {
  if (groupValues.length === 0) {
    return "";
  }
  return groupValues.join(GROUP_KEY_DELIMITER);
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function pad4(n) {
  return String(n).padStart(4, "0");
}
function formatHumanMinute(date) {
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}
function formatPeriodBound(input) {
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    return input;
  }
  return formatHumanMinute(date);
}
function formatGranularity(granularity) {
  if ("minutes" in granularity) {
    return `${granularity.minutes}m`;
  }
  if ("hours" in granularity) {
    return `${granularity.hours}h`;
  }
  return `${granularity.days}d`;
}
function formatUnitLabel(unit) {
  switch (normalizeUnit(unit)) {
    case "milliseconds":
      return "ms";
    case "seconds":
      return "s";
    case "usd":
    case "us dollars":
      return "USD";
    case "gigabyte hour":
    case "gigabyte hours":
      return "GB-h";
    default:
      return unit;
  }
}
function isCountIntegerDisplay(measureType, aggregation) {
  return measureType === "count" && aggregation === "sum";
}
function formatNumber(value, measureType, aggregation, opts) {
  if (isCountIntegerDisplay(measureType, aggregation)) {
    if (opts?.preserveFractionalCountSum && !Number.isInteger(value)) {
      return formatDecimal(value);
    }
    return formatCount(value);
  }
  return formatDecimal(value);
}
function getStatColumns(aggregation) {
  if (aggregation === "sum") {
    return ["total", "avg", "min", "max"];
  }
  return ["avg", "min", "max"];
}
function toNumericValue(value) {
  if (value === null || value === void 0) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function isNonNullNumber(value) {
  return value !== null;
}
function isPointWithValue(point) {
  return point.value !== null;
}
function getOrCreate(map, key, make) {
  const existing = map.get(key);
  if (existing !== void 0) {
    return existing;
  }
  const created = make();
  map.set(key, created);
  return created;
}
function getGroupFieldValue(row, field) {
  const value = row[field];
  return value == null || value === "" ? "(not set)" : String(value);
}
function normalizeTimestampToIso(timestamp) {
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}
function formatStatCell(column, stats, measureType, aggregation, periodStart, periodEnd) {
  switch (column) {
    case "total":
      return formatNumber(stats.total, measureType, aggregation);
    case "avg":
      return formatNumber(stats.avg, measureType, aggregation, {
        preserveFractionalCountSum: true
      });
    case "min": {
      const ts = formatMinMaxTimestamp(
        new Date(stats.min.timestamp),
        periodStart,
        periodEnd
      );
      return `${formatNumber(stats.min.value, measureType, aggregation)} at ${ts}`;
    }
    case "max": {
      const ts = formatMinMaxTimestamp(
        new Date(stats.max.timestamp),
        periodStart,
        periodEnd
      );
      return `${formatNumber(stats.max.value, measureType, aggregation)} at ${ts}`;
    }
  }
}
function buildExpectedTimestamps(periodStart, periodEnd, granularityMs) {
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  if (isNaN(start) || isNaN(end) || granularityMs <= 0 || end <= start) {
    return [];
  }
  const timestamps = [];
  for (let current = start; current < end; current += granularityMs) {
    timestamps.push(new Date(current).toISOString());
  }
  return timestamps;
}
function getMeasureType(unit) {
  const normalized = normalizeUnit(unit);
  if (COUNT_UNITS.has(normalized)) {
    return "count";
  }
  if (DURATION_UNITS.has(normalized)) {
    return "duration";
  }
  if (BYTES_UNITS.has(normalized)) {
    return "bytes";
  }
  if (RATIO_UNITS.has(normalized)) {
    return "ratio";
  }
  return "ratio";
}
function formatCount(n) {
  return Math.round(n).toLocaleString("en-US");
}
function formatDecimal(n) {
  if (!Number.isFinite(n)) {
    return String(n);
  }
  if (n === 0 || Object.is(n, -0)) {
    return "0";
  }
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1) {
    return `${sign}${abs.toFixed(1)}`;
  }
  const exponent = Math.floor(Math.log10(abs));
  const decimals = Math.min(20, Math.max(2, -exponent + 1));
  const fixed = abs.toFixed(decimals);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "").replace(/\.$/, "");
  return `${sign}${trimmed}`;
}
function formatMinMaxTimestamp(date, periodStart, periodEnd) {
  const sameDay = periodStart.getUTCFullYear() === periodEnd.getUTCFullYear() && periodStart.getUTCMonth() === periodEnd.getUTCMonth() && periodStart.getUTCDate() === periodEnd.getUTCDate();
  if (sameDay) {
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  }
  const sameYear = periodStart.getUTCFullYear() === periodEnd.getUTCFullYear();
  if (sameYear) {
    return `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  }
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}
function extractGroupedSeries(data, groupBy, rollupColumn, periodStart, periodEnd, granularityMs) {
  const expectedTimestamps = buildExpectedTimestamps(
    periodStart,
    periodEnd,
    granularityMs
  );
  const groups = [];
  const groupValues = /* @__PURE__ */ new Map();
  const valueByGroup = /* @__PURE__ */ new Map();
  for (const row of data) {
    const values = groupBy.map((field) => getGroupFieldValue(row, field));
    const key = toGroupKey(values);
    if (!groupValues.has(key)) {
      groups.push(key);
      groupValues.set(key, values);
    }
    const groupMap = getOrCreate(valueByGroup, key, () => /* @__PURE__ */ new Map());
    const rawTimestamp = row.timestamp;
    if (rawTimestamp.length === 0) {
      continue;
    }
    const timestamp = normalizeTimestampToIso(rawTimestamp);
    if (!timestamp) {
      continue;
    }
    const numeric = toNumericValue(row[rollupColumn]);
    groupMap.set(timestamp, numeric);
  }
  const series = /* @__PURE__ */ new Map();
  for (const key of groups) {
    const byTimestamp = valueByGroup.get(key);
    if (!byTimestamp) {
      continue;
    }
    const points = expectedTimestamps.map((timestamp) => ({
      timestamp,
      value: byTimestamp.has(timestamp) ? byTimestamp.get(timestamp) ?? null : null
    }));
    series.set(key, points);
  }
  return { groups, series, groupValues };
}
function computeGroupStats(points) {
  const present = points.filter(isPointWithValue);
  if (present.length === 0) {
    return {
      total: 0,
      avg: 0,
      min: { value: 0, timestamp: "" },
      max: { value: 0, timestamp: "" },
      count: 0,
      allMissing: true
    };
  }
  let total = 0;
  let min = present[0];
  let max = present[0];
  for (const point of present) {
    total += point.value;
    if (point.value < min.value) {
      min = point;
    }
    if (point.value > max.value) {
      max = point;
    }
  }
  return {
    total,
    avg: total / present.length,
    min: { value: min.value, timestamp: min.timestamp },
    max: { value: max.value, timestamp: max.timestamp },
    count: present.length,
    allMissing: false
  };
}
var MAX_GROUP_VALUE_LENGTH = 60;
function ellipsizeMiddle(str, maxLength) {
  if (str.length <= maxLength)
    return str;
  const endLength = Math.floor((maxLength - 1) / 2);
  const startLength = maxLength - 1 - endLength;
  return `${str.slice(0, startLength)}\u2026${str.slice(str.length - endLength)}`;
}
function downsample(values, maxLen) {
  if (maxLen <= 0) {
    return [];
  }
  if (values.length <= maxLen) {
    return [...values];
  }
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const start = Math.floor(i * values.length / maxLen);
    const end = Math.floor((i + 1) * values.length / maxLen);
    const bucket = values.slice(start, Math.max(start + 1, end));
    const nullCount = bucket.filter((value) => value === null).length;
    if (nullCount === bucket.length || nullCount > bucket.length / 2) {
      result.push(null);
      continue;
    }
    const present = bucket.filter(isNonNullNumber);
    const avg = present.reduce((sum, value) => sum + value, 0) / present.length;
    result.push(avg);
  }
  return result;
}
function generateSparkline(values) {
  const sampled = downsample(values, MAX_SPARKLINE_LENGTH);
  if (sampled.length === 0) {
    return "";
  }
  const present = sampled.filter(isNonNullNumber);
  if (present.length === 0) {
    return sampled.map(() => MISSING_CHAR).join("");
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (min === max) {
    const block = min === 0 ? BLOCKS[0] : BLOCKS[BLOCKS.length - 1];
    return sampled.map((value) => value === null ? MISSING_CHAR : block).join("");
  }
  const range = max - min;
  return sampled.map((value) => {
    if (value === null) {
      return MISSING_CHAR;
    }
    const ratio = (value - min) / range;
    const index = Math.max(
      0,
      Math.min(BLOCKS.length - 1, Math.round(ratio * (BLOCKS.length - 1)))
    );
    return BLOCKS[index];
  }).join("");
}
function formatMetadataHeader(opts) {
  const rows = [
    {
      key: "Metric",
      value: `${opts.metric} ${opts.aggregation}`
    },
    {
      key: "Period",
      value: `${formatPeriodBound(opts.periodStart)} to ${formatPeriodBound(opts.periodEnd)}`
    },
    {
      key: "Interval",
      value: formatGranularity(opts.granularity)
    }
  ];
  if (opts.filter) {
    rows.push({ key: "Filter", value: opts.filter });
  }
  if (opts.scope.type === "project") {
    rows.push({
      key: "Project",
      value: `${opts.projectName ?? opts.scope.projectIds[0]} (${opts.teamName ?? opts.scope.ownerId})`
    });
  } else {
    rows.push({
      key: "Team",
      value: `${opts.teamName ?? opts.scope.ownerId} (all projects)`
    });
  }
  if (opts.unit && normalizeUnit(opts.unit) !== "count") {
    rows.push({ key: "Units", value: formatUnitLabel(opts.unit) });
  }
  if (typeof opts.groupCount === "number") {
    rows.push({ key: "Groups", value: String(opts.groupCount) });
  }
  return rows.map((row) => `> ${import_chalk.default.gray(`${row.key}:`)} ${row.value}`).join("\n");
}
function formatSummaryTable(opts) {
  const statColumns = getStatColumns(opts.aggregation);
  const header = [...opts.groupByFields, ...statColumns];
  const rows = [header.map((name) => import_chalk.default.bold(import_chalk.default.cyan(name)))];
  for (const row of opts.rows) {
    const nextRow = row.groupValues.map(
      (v) => ellipsizeMiddle(v, MAX_GROUP_VALUE_LENGTH)
    );
    if (row.stats.allMissing) {
      nextRow.push(...statColumns.map(() => "--"));
      rows.push(nextRow);
      continue;
    }
    nextRow.push(
      ...statColumns.map(
        (column) => formatStatCell(
          column,
          row.stats,
          opts.measureType,
          opts.aggregation,
          opts.periodStart,
          opts.periodEnd
        )
      )
    );
    rows.push(nextRow);
  }
  const centeredColumns = /* @__PURE__ */ new Set(["min", "max"]);
  const align = header.map(
    (col) => centeredColumns.has(col) ? "c" : "r"
  );
  return indent_default(
    table(rows, {
      align,
      hsep: 2
    }),
    2
  );
}
function formatSparklineSection(groupRows, sparklines, groupByFields) {
  const lines = ["sparklines:"];
  if (groupRows.length === 0) {
    const sparkline = sparklines[0];
    if (sparkline) {
      lines.push(indent_default(sparkline, 2));
    }
    return lines.join("\n");
  }
  const rowsWithSparklines = groupRows.map((groupValues, index) => ({
    groupValues,
    sparkline: sparklines[index] ?? ""
  }));
  const rows = [
    [...groupByFields, "sparkline"].map((name) => import_chalk.default.bold(import_chalk.default.cyan(name))),
    ...rowsWithSparklines.map(({ groupValues, sparkline }) => [
      ...groupValues.map((v) => ellipsizeMiddle(v, MAX_GROUP_VALUE_LENGTH)),
      sparkline
    ])
  ];
  const align = groupByFields.map(() => "r");
  align.push("l");
  lines.push(
    indent_default(
      table(rows, {
        align,
        hsep: 2
      }),
      2
    )
  );
  return lines.join("\n");
}
function getEffectiveDisplay(baseUnit, aggregation) {
  switch (aggregation) {
    case "percent":
      return { displayUnit: "%", measureType: "ratio" };
    case "persecond": {
      const label = baseUnit ? formatUnitLabel(baseUnit) : void 0;
      return {
        displayUnit: label ? `${label}/s` : void 0,
        measureType: getMeasureType(baseUnit ?? "ratio")
      };
    }
    case "unique":
      return { displayUnit: void 0, measureType: "count" };
    default:
      return {
        displayUnit: baseUnit,
        measureType: getMeasureType(baseUnit ?? "ratio")
      };
  }
}
function formatText(response, opts) {
  const rollupColumn = getRollupColumnName(opts.metric, opts.aggregation);
  const { displayUnit, measureType } = getEffectiveDisplay(
    opts.metricUnit,
    opts.aggregation
  );
  const granularityMs = toGranularityMsFromDuration(opts.granularity);
  const { groups, series, groupValues } = extractGroupedSeries(
    response.data ?? [],
    opts.groupBy,
    rollupColumn,
    opts.periodStart,
    opts.periodEnd,
    granularityMs
  );
  const metadata = formatMetadataHeader({
    metric: opts.metric,
    aggregation: opts.aggregation,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    granularity: opts.granularity,
    filter: opts.filter,
    scope: opts.scope,
    projectName: opts.projectName,
    teamName: opts.teamName,
    unit: displayUnit,
    groupCount: opts.groupBy.length > 0 ? groups.length : void 0
  });
  if (groups.length === 0) {
    return `${metadata}

No data found for this period.
`;
  }
  const summaryRows = [];
  const groupRows = [];
  const sparklineRows = [];
  for (const key of groups) {
    const points = series.get(key) ?? [];
    const values = points.map((point) => point.value);
    const currentGroupValues = groupValues.get(key) ?? [];
    summaryRows.push({
      groupValues: currentGroupValues,
      stats: computeGroupStats(points)
    });
    groupRows.push(currentGroupValues);
    sparklineRows.push(generateSparkline(values));
  }
  const summaryTable = formatSummaryTable({
    rows: summaryRows,
    groupByFields: opts.groupBy,
    measureType,
    aggregation: opts.aggregation,
    periodStart: new Date(opts.periodStart),
    periodEnd: new Date(opts.periodEnd)
  });
  const groupedOutput = opts.groupBy.length > 0;
  const sparklineSection = formatSparklineSection(
    groupedOutput ? groupRows : [],
    sparklineRows,
    opts.groupBy
  );
  const sections = [metadata, summaryTable, sparklineSection];
  return `${sections.join("\n\n")}
`;
}

// src/commands/metrics/query.ts
function handleValidationError(result, jsonOutput, client) {
  if (jsonOutput) {
    client.stdout.write(
      formatErrorJson(result.code, result.message, result.allowedValues)
    );
  } else {
    output_manager_default.error(result.message);
  }
  return 1;
}
async function resolveQueryScope(client, opts) {
  if (opts.project || opts.all) {
    const { team } = await getScope(client);
    if (!team) {
      const errMsg = "No team context found. Run `vercel switch` to select a team, or use `vercel link` in a project directory.";
      if (opts.jsonOutput) {
        client.stdout.write(formatErrorJson("NO_TEAM", errMsg));
      } else {
        output_manager_default.error(errMsg);
      }
      return 1;
    }
    if (opts.all) {
      return {
        scope: { type: "owner", ownerId: team.id },
        accountId: team.id,
        teamName: team.slug
      };
    }
    const project = await getProjectByNameOrId(client, opts.project, team.id);
    if (project instanceof ProjectNotFound) {
      const errMsg = `Project "${opts.project}" was not found in team "${team.slug}".`;
      if (opts.jsonOutput) {
        client.stdout.write(formatErrorJson("PROJECT_NOT_FOUND", errMsg));
      } else {
        output_manager_default.error(errMsg);
      }
      return 1;
    }
    return {
      scope: {
        type: "project",
        ownerId: team.id,
        projectIds: [project.id]
      },
      accountId: team.id,
      teamName: team.slug,
      projectName: project.name
    };
  }
  const linkedProject = await getLinkedProject(client);
  if (linkedProject.status === "error") {
    return linkedProject.exitCode;
  }
  if (linkedProject.status === "not_linked") {
    const errMsg = "No linked project found. Run `vercel link` to link a project, or use --project <name-or-id> or --all.";
    if (opts.jsonOutput) {
      client.stdout.write(formatErrorJson("NOT_LINKED", errMsg));
    } else {
      output_manager_default.error(errMsg);
    }
    return 1;
  }
  return {
    scope: {
      type: "project",
      ownerId: linkedProject.org.id,
      projectIds: [linkedProject.project.id]
    },
    accountId: linkedProject.org.id,
    teamName: linkedProject.org.slug,
    projectName: linkedProject.project.name
  };
}
async function query(client, telemetry) {
  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(metricsCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }
  const flags = parsedArgs.flags;
  const positionalArgs = parsedArgs.args.slice(1);
  const positionalMetric = positionalArgs[0] === "query" ? positionalArgs[1] : positionalArgs[0];
  const formatResult = validateJsonOutput(flags);
  if (!formatResult.valid) {
    output_manager_default.error(formatResult.error);
    return 1;
  }
  const jsonOutput = formatResult.jsonOutput;
  const metricFlag = positionalMetric;
  const aggregationFlag = flags["--aggregation"];
  const groupBy = flags["--group-by"] ?? [];
  const limit = flags["--limit"];
  const filter = flags["--filter"];
  const since = flags["--since"];
  const until = flags["--until"];
  const granularity = flags["--granularity"];
  const project = flags["--project"];
  const all = flags["--all"];
  telemetry.trackCliArgumentMetricId(metricFlag);
  telemetry.trackCliOptionAggregation(aggregationFlag);
  telemetry.trackCliOptionGroupBy(groupBy.length > 0 ? groupBy : void 0);
  telemetry.trackCliOptionLimit(limit);
  telemetry.trackCliOptionFilter(filter);
  telemetry.trackCliOptionSince(since);
  telemetry.trackCliOptionUntil(until);
  telemetry.trackCliOptionGranularity(granularity);
  telemetry.trackCliOptionProject(project);
  telemetry.trackCliFlagAll(all);
  telemetry.trackCliOptionFormat(flags["--format"]);
  const requiredMetric = validateRequiredMetric(metricFlag);
  if (!requiredMetric.valid) {
    return handleValidationError(requiredMetric, jsonOutput, client);
  }
  const metric = requiredMetric.value;
  const mutualResult = validateMutualExclusivity(all, project);
  if (!mutualResult.valid) {
    return handleValidationError(mutualResult, jsonOutput, client);
  }
  const scopeResult = await resolveQueryScope(client, {
    project,
    all,
    jsonOutput
  });
  if (typeof scopeResult === "number") {
    return scopeResult;
  }
  const { scope, accountId, teamName, projectName } = scopeResult;
  const detailOrExitCode = await fetchMetricDetailOrExit(
    client,
    accountId,
    metric,
    jsonOutput
  );
  if (typeof detailOrExitCode === "number") {
    return detailOrExitCode;
  }
  const aggregationInput = aggregationFlag ?? getDefaultAggregation(detailOrExitCode, metric) ?? "sum";
  const aggregation = aggregationInput;
  let startTime;
  let endTime;
  try {
    ({ startTime, endTime } = resolveTimeRange(since, until));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (jsonOutput) {
      client.stdout.write(formatErrorJson("INVALID_TIME", errMsg));
    } else {
      output_manager_default.error(errMsg);
    }
    return 1;
  }
  const rangeMs = endTime.getTime() - startTime.getTime();
  const granResult = computeGranularity(rangeMs, granularity);
  if (granResult.adjusted && granResult.notice) {
    output_manager_default.log(`Notice: ${granResult.notice}`);
  }
  const rounded = roundTimeBoundaries(
    startTime,
    endTime,
    toGranularityMsFromDuration(granResult.duration)
  );
  const body = {
    scope,
    metric,
    aggregation,
    startTime: rounded.start.toISOString(),
    endTime: rounded.end.toISOString(),
    granularity: granResult.duration,
    ...groupBy.length > 0 ? { groupBy } : {},
    ...filter ? { filter } : {},
    limit: limit ?? 10
  };
  output_manager_default.spinner("Querying metrics...");
  let response;
  try {
    response = await client.fetch(
      "/v2/observability/query",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        accountId,
        bailOn429: true
      }
    );
  } catch (err) {
    if (isAPIError(err)) {
      return handleApiError(err, jsonOutput, client);
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    if (jsonOutput) {
      client.stdout.write(formatErrorJson("NETWORK_ERROR", errMsg));
    } else {
      output_manager_default.error(errMsg);
    }
    return 1;
  } finally {
    output_manager_default.stopSpinner();
  }
  if (jsonOutput) {
    client.stdout.write(
      formatQueryJson(
        {
          metric,
          aggregation,
          groupBy,
          filter,
          startTime: rounded.start.toISOString(),
          endTime: rounded.end.toISOString(),
          granularity: granResult.duration
        },
        response
      )
    );
  } else {
    client.stdout.write(
      formatText(response, {
        metric,
        metricUnit: detailOrExitCode.find((item) => item.id === metric)?.unit ?? "count",
        aggregation,
        groupBy,
        filter,
        scope,
        projectName,
        teamName,
        periodStart: rounded.start.toISOString(),
        periodEnd: rounded.end.toISOString(),
        granularity: granResult.duration
      })
    );
  }
  return 0;
}
export {
  query as default
};
