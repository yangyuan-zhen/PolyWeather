import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  resolveAlertsScope
} from "./chunk-UP2QQYRS.js";
import {
  handleValidationError,
  normalizeRepeatableStringFilters,
  outputError,
  validateAllProjectMutualExclusivity,
  validateOptionalIntegerRange,
  validateTimeBound,
  validateTimeOrder
} from "./chunk-HTOH3MSD.js";
import "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  alertsCommand
} from "./chunk-TAOVG4PS.js";
import "./chunk-DVQ4SIWF.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import {
  table
} from "./chunk-GE6G37P4.js";
import "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  buildCommandWithGlobalFlags,
  outputAgentError,
  shouldEmitNonInteractiveCommandError
} from "./chunk-XKHLPA6V.js";
import {
  require_ms
} from "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
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

// src/commands/alerts/list.ts
var import_ms = __toESM(require_ms(), 1);
var import_chalk = __toESM(require_source(), 1);
function handleApiError(err, jsonOutput, client) {
  const message = err.status === 401 || err.status === 403 ? "You do not have access to alerts in this scope. Pass --token <TOKEN> and --scope <team-slug> with Alerts read access." : err.status >= 500 ? `The alerts endpoint failed on the server (${err.status}). Re-run with --debug and share the x-vercel-id from the failed request.` : err.serverMessage || `API error (${err.status}).`;
  const reason = err.status === 401 ? "not_authorized" : err.status === 403 ? "forbidden" : err.status === 404 ? AGENT_REASON.NOT_FOUND : err.status === 429 ? "rate_limited" : AGENT_REASON.API_ERROR;
  outputAgentError(
    client,
    {
      status: "error",
      reason,
      message,
      ...err.status === 401 || err.status === 403 ? {
        hint: "Confirm team scope; use --scope <team-slug> if alerts belong to another team.",
        next: [
          {
            command: buildCommandWithGlobalFlags(client.argv, "whoami"),
            when: "See current user and team"
          },
          {
            command: buildCommandWithGlobalFlags(client.argv, "alerts"),
            when: "Retry listing alerts after fixing scope or permissions"
          }
        ]
      } : {}
    },
    1
  );
  return outputError(client, jsonOutput, err.code || "API_ERROR", message);
}
function getDefaultRange() {
  const to = /* @__PURE__ */ new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1e3);
  return { from: from.toISOString(), to: to.toISOString() };
}
function getGroupTitle(group) {
  return group.ai?.title || "Alert group";
}
function parseDateInput(value) {
  if (value === void 0) {
    return void 0;
  }
  const epochMs = value < 1e12 ? value * 1e3 : value;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? void 0 : date;
}
function formatDateForDisplay(value) {
  const date = parseDateInput(value);
  if (!date) {
    return "-";
  }
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  });
}
function getStartedAt(group) {
  return formatDateForDisplay(getGroupStartedAt(group)?.getTime());
}
function getGroupStartedAt(group) {
  return parseDateInput(group.recordedStartedAt) || parseDateInput(group.alerts?.[0]?.startedAt);
}
function getGroupResolvedAt(group) {
  const resolvedTimes = (group.alerts ?? []).map((alert) => parseDateInput(alert.resolvedAt)).filter((d) => Boolean(d)).map((d) => d.getTime());
  if (resolvedTimes.length > 0) {
    return new Date(Math.max(...resolvedTimes));
  }
  return getGroupStartedAt(group);
}
function getStatus(group) {
  const normalizedStatus = (group.status || "").toLowerCase();
  if (normalizedStatus === "active") {
    return "active";
  }
  if (normalizedStatus === "resolved") {
    const startedAt = getGroupStartedAt(group);
    const resolvedAt = getGroupResolvedAt(group);
    if (startedAt && resolvedAt && resolvedAt.getTime() >= startedAt.getTime()) {
      return `resolved after ${(0, import_ms.default)(resolvedAt.getTime() - startedAt.getTime())}`;
    }
    return "resolved";
  }
  return group.status || "-";
}
function getResolvedAt(group) {
  const normalizedStatus = (group.status || "").toLowerCase();
  if (normalizedStatus === "active") {
    return "active";
  }
  return formatDateForDisplay(getGroupResolvedAt(group)?.getTime());
}
function getAlertsCount(group) {
  return String(group.alerts?.length ?? 0);
}
function validationFailureForAgents(client, result, jsonOutput) {
  if (shouldEmitNonInteractiveCommandError(client)) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.INVALID_ARGUMENTS,
        message: result.message,
        next: [
          {
            command: buildCommandWithGlobalFlags(client.argv, "alerts --help"),
            when: "See valid `alerts` list flags and examples"
          }
        ]
      },
      1
    );
  }
  return handleValidationError(result, jsonOutput, client);
}
function printGroups(groups) {
  if (groups.length === 0) {
    output_manager_default.log("No alerts found.");
    return;
  }
  const headers = [
    "Title",
    "Group id",
    "Started At",
    "Type",
    "Status",
    "Alerts"
  ].map((h) => import_chalk.default.cyan(h));
  const rows = [
    headers,
    ...groups.map((group) => [
      import_chalk.default.bold(getGroupTitle(group)),
      import_chalk.default.dim(group.id || "-"),
      getStartedAt(group),
      group.type || "-",
      getStatus(group),
      getAlertsCount(group)
    ])
  ];
  const tableOutput = table(rows, { hsep: 3 }).split("\n").map((line) => line.trimEnd()).join("\n").replace(/^/gm, "  ");
  output_manager_default.print(`
${tableOutput}
`);
}
function printAiSections(groups) {
  if (groups.length === 0) {
    output_manager_default.log("No alerts found.");
    return;
  }
  const rendered = groups.map((group) => {
    const title = getGroupTitle(group);
    const summary = group.ai?.currentSummary || "N/A";
    const findings = group.ai?.keyFindings?.filter(Boolean) ?? [];
    const findingsOutput = findings.length > 0 ? findings.map((finding) => `  - ${finding}`).join("\n") : "  - N/A";
    return [
      import_chalk.default.bold(title),
      `   ${import_chalk.default.cyan("Resolved At:")} ${getResolvedAt(group)}`,
      `   ${import_chalk.default.cyan("Summary:")} ${summary}`,
      `   ${import_chalk.default.cyan("Key Findings:")}`,
      findingsOutput
    ].join("\n");
  }).join("\n\n");
  output_manager_default.print(`
${rendered}
`);
}
function trackTelemetry(flags, types, telemetry) {
  telemetry.trackCliOptionType(types.length > 0 ? types : void 0);
  telemetry.trackCliOptionSince(flags["--since"]);
  telemetry.trackCliOptionUntil(flags["--until"]);
  telemetry.trackCliOptionProject(flags["--project"]);
  telemetry.trackCliFlagAll(flags["--all"]);
  telemetry.trackCliFlagAi(flags["--ai"]);
  telemetry.trackCliOptionLimit(flags["--limit"]);
  telemetry.trackCliOptionFormat(flags["--format"]);
}
function parseFlags(client) {
  const flagsSpecification = getFlagsSpecification(alertsCommand.options);
  try {
    const parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
    return parsedArgs.flags;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const projectFlagMissingArg = msg.includes("--project") && msg.includes("requires argument");
    if (shouldEmitNonInteractiveCommandError(client)) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: AGENT_REASON.INVALID_ARGUMENTS,
          message: projectFlagMissingArg ? "`--project` requires a project name or id (for example `--project my-app`)." : msg,
          next: projectFlagMissingArg ? [
            {
              command: buildCommandWithGlobalFlags(
                client.argv,
                "alerts --project <name-or-id>"
              ),
              when: "Re-run with a project name or id (replace placeholder)"
            },
            {
              command: buildCommandWithGlobalFlags(
                client.argv,
                "alerts --help"
              ),
              when: "See all `alerts` flags and examples"
            }
          ] : [
            {
              command: buildCommandWithGlobalFlags(
                client.argv,
                "alerts --help"
              ),
              when: "See valid flags and examples"
            }
          ]
        },
        1
      );
    }
    printError(err);
    return 1;
  }
}
function resolveValidatedInputs(flags, client, jsonOutput) {
  const types = normalizeRepeatableStringFilters(flags["--type"]);
  const limitResult = validateOptionalIntegerRange(flags["--limit"], {
    flag: "--limit",
    min: 1,
    max: 100
  });
  if (!limitResult.valid) {
    return validationFailureForAgents(client, limitResult, jsonOutput);
  }
  const mutualResult = validateAllProjectMutualExclusivity(
    flags["--all"],
    flags["--project"]
  );
  if (!mutualResult.valid) {
    return validationFailureForAgents(client, mutualResult, jsonOutput);
  }
  const sinceResult = validateTimeBound(flags["--since"]);
  if (!sinceResult.valid) {
    return validationFailureForAgents(client, sinceResult, jsonOutput);
  }
  const untilResult = validateTimeBound(flags["--until"]);
  if (!untilResult.valid) {
    return validationFailureForAgents(client, untilResult, jsonOutput);
  }
  const timeOrderResult = validateTimeOrder(
    sinceResult.value,
    untilResult.value
  );
  if (!timeOrderResult.valid) {
    return validationFailureForAgents(client, timeOrderResult, jsonOutput);
  }
  return {
    limit: limitResult.value,
    types,
    since: sinceResult.value,
    until: untilResult.value
  };
}
function buildAlertsQuery(scope, inputs) {
  const query = new URLSearchParams({
    teamId: scope.teamId
  });
  if (scope.projectId) {
    query.set("projectId", scope.projectId);
  }
  if (inputs.limit) {
    query.set("limit", String(inputs.limit));
  }
  for (const type of inputs.types) {
    query.append("types", type);
  }
  if (inputs.since) {
    query.set("from", inputs.since.toISOString());
  }
  if (inputs.until) {
    query.set("to", inputs.until.toISOString());
  }
  if (!inputs.since && !inputs.until) {
    const defaultRange = getDefaultRange();
    query.set("from", defaultRange.from);
    query.set("to", defaultRange.to);
  }
  return query;
}
async function list(client, telemetry) {
  const flags = parseFlags(client);
  if (typeof flags === "number") {
    return flags;
  }
  const formatResult = validateJsonOutput(flags);
  if (!formatResult.valid) {
    output_manager_default.error(formatResult.error);
    return 1;
  }
  const jsonOutput = formatResult.jsonOutput;
  const types = normalizeRepeatableStringFilters(flags["--type"]);
  trackTelemetry(flags, types, telemetry);
  const validatedInputs = resolveValidatedInputs(flags, client, jsonOutput);
  if (typeof validatedInputs === "number") {
    return validatedInputs;
  }
  const scope = await resolveAlertsScope(client, {
    project: flags["--project"],
    all: flags["--all"],
    jsonOutput
  });
  if (typeof scope === "number") {
    return scope;
  }
  const query = buildAlertsQuery(scope, validatedInputs);
  const requestPath = `/alerts/v3/groups?${query.toString()}`;
  output_manager_default.debug(`Fetching alerts from ${requestPath}`);
  output_manager_default.spinner("Fetching alerts...");
  try {
    const groups = await client.fetch(requestPath);
    if (jsonOutput) {
      client.stdout.write(`${JSON.stringify({ groups }, null, 2)}
`);
    } else {
      if (flags["--ai"]) {
        printAiSections(groups);
      } else {
        printGroups(groups);
      }
    }
    return 0;
  } catch (err) {
    if (isAPIError(err)) {
      return handleApiError(err, jsonOutput, client);
    }
    output_manager_default.debug(err);
    const message = `Failed to fetch alerts: ${err.message || String(err)}`;
    return outputError(client, jsonOutput, "UNEXPECTED_ERROR", message);
  } finally {
    output_manager_default.stopSpinner();
  }
}
export {
  list as default
};
