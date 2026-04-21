import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  handleValidationError,
  normalizeRepeatableStringFilters,
  outputError,
  validateAllProjectMutualExclusivity,
  validateIntegerRangeWithDefault,
  validateTimeBound,
  validateTimeOrder
} from "./chunk-HTOH3MSD.js";
import {
  getCommandFlags
} from "./chunk-EOZFDJSY.js";
import {
  getScope
} from "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  activityCommand
} from "./chunk-UWKTUK3W.js";
import {
  getLinkedProject,
  getProjectByNameOrId
} from "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import "./chunk-XKHLPA6V.js";
import "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  ProjectNotFound,
  getCommandName,
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

// src/commands/activity/list.ts
var import_chalk = __toESM(require_source(), 1);
function validateNext(next) {
  if (next === void 0) {
    return { valid: true, value: void 0 };
  }
  if (Number.isNaN(next)) {
    return {
      valid: false,
      code: "INVALID_NEXT",
      message: "Please provide a number for flag `--next`."
    };
  }
  const date = new Date(next);
  if (Number.isNaN(date.getTime())) {
    return {
      valid: false,
      code: "INVALID_NEXT",
      message: "Please provide a valid unix timestamp in milliseconds for `--next`."
    };
  }
  return { valid: true, value: date };
}
function handleApiError(err, jsonOutput, client) {
  if (err.status === 403) {
    return outputError(
      client,
      jsonOutput,
      "FORBIDDEN",
      "You do not have permission to list activity events. Required permissions: Event: List or OwnEvent: List."
    );
  }
  return outputError(
    client,
    jsonOutput,
    err.code || "API_ERROR",
    err.serverMessage || `API error (${err.status}).`
  );
}
function formatActor(event) {
  const principal = event.principal;
  if (!principal) {
    return event.principalId || "-";
  }
  if (principal.type === "system") {
    return "system";
  }
  if (principal.username) {
    return principal.username;
  }
  if (principal.name) {
    return principal.name;
  }
  if (principal.slug) {
    return principal.slug;
  }
  if (principal.email) {
    return principal.email;
  }
  return event.principalId || "-";
}
function formatTimestamp(createdAt) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return "-";
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toISOString();
}
function formatEventText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function printExpandedEvents(events) {
  const lines = [""];
  events.forEach((event) => {
    lines.push(`${import_chalk.default.gray("-")} ${formatEventText(event.text)}`);
    lines.push(`    ${import_chalk.default.cyan("Type".padEnd(14))}${event.type ?? "-"}`);
    lines.push(`    ${import_chalk.default.cyan("Actor".padEnd(14))}${formatActor(event)}`);
    lines.push(
      `    ${import_chalk.default.cyan("Timestamp".padEnd(14))}${formatTimestamp(event.createdAt)}`
    );
    lines.push(`    ${import_chalk.default.cyan("ID".padEnd(14))}${event.id}`);
    lines.push("");
  });
  output_manager_default.print(`${lines.join("\n")}
`);
}
function trackTelemetry(flags, types, telemetry) {
  telemetry.trackCliOptionType(types.length > 0 ? types : void 0);
  telemetry.trackCliOptionSince(flags["--since"]);
  telemetry.trackCliOptionUntil(flags["--until"]);
  telemetry.trackCliOptionProject(flags["--project"]);
  telemetry.trackCliFlagAll(flags["--all"]);
  telemetry.trackCliOptionLimit(flags["--limit"]);
  telemetry.trackCliOptionNext(flags["--next"]);
  telemetry.trackCliOptionFormat(flags["--format"]);
}
function parseFlags(client) {
  const flagsSpecification = getFlagsSpecification(activityCommand.options);
  try {
    const parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
    return parsedArgs.flags;
  } catch (err) {
    printError(err);
    return 1;
  }
}
function resolveValidatedInputs(flags, jsonOutput, client, normalizedTypes) {
  const limitResult = validateIntegerRangeWithDefault(flags["--limit"], {
    flag: "--limit",
    min: 1,
    max: 100,
    defaultValue: 20
  });
  if (!limitResult.valid) {
    return handleValidationError(limitResult, jsonOutput, client);
  }
  const mutualResult = validateAllProjectMutualExclusivity(
    flags["--all"],
    flags["--project"]
  );
  if (!mutualResult.valid) {
    return handleValidationError(mutualResult, jsonOutput, client);
  }
  const sinceResult = validateTimeBound(flags["--since"]);
  if (!sinceResult.valid) {
    return handleValidationError(sinceResult, jsonOutput, client);
  }
  const nextResult = validateNext(flags["--next"]);
  if (!nextResult.valid) {
    return handleValidationError(nextResult, jsonOutput, client);
  }
  let until = nextResult.value;
  if (!until) {
    const untilResult = validateTimeBound(flags["--until"]);
    if (!untilResult.valid) {
      return handleValidationError(untilResult, jsonOutput, client);
    }
    until = untilResult.value;
  }
  const since = sinceResult.value;
  const timeOrderResult = validateTimeOrder(since, until);
  if (!timeOrderResult.valid) {
    return handleValidationError(timeOrderResult, jsonOutput, client);
  }
  return {
    limit: limitResult.value,
    types: normalizedTypes,
    since,
    until
  };
}
async function resolveScope(client, opts) {
  if (opts.all || opts.project) {
    const { team } = await getScope(client);
    if (!team) {
      return outputError(
        client,
        opts.jsonOutput,
        "NO_TEAM",
        "No team context found. Run `vercel switch` to select a team, or use `vercel link` in a project directory."
      );
    }
    if (opts.all) {
      return {
        teamId: team.id,
        teamSlug: team.slug
      };
    }
    let projectResult;
    try {
      projectResult = await getProjectByNameOrId(
        client,
        opts.project,
        team.id
      );
    } catch (err) {
      if (isAPIError(err)) {
        return outputError(
          client,
          opts.jsonOutput,
          err.code || "API_ERROR",
          err.serverMessage || (err.status === 403 ? `You do not have permission to access project "${opts.project}" in team "${team.slug}".` : `API error (${err.status}).`)
        );
      }
      throw err;
    }
    if (projectResult instanceof ProjectNotFound) {
      return outputError(
        client,
        opts.jsonOutput,
        "PROJECT_NOT_FOUND",
        `Project "${opts.project}" was not found in team "${team.slug}".`
      );
    }
    return {
      teamId: team.id,
      teamSlug: team.slug,
      projectIds: [projectResult.id],
      projectName: projectResult.name
    };
  }
  const linkedProject = await getLinkedProject(client);
  if (linkedProject.status === "error") {
    return linkedProject.exitCode;
  }
  if (linkedProject.status === "not_linked") {
    return outputError(
      client,
      opts.jsonOutput,
      "NOT_LINKED",
      "No linked project found. Run `vercel link` to link a project, or use --project <name> or --all."
    );
  }
  const isTeamProject = linkedProject.org.type === "team";
  return {
    projectIds: [linkedProject.project.id],
    projectName: linkedProject.project.name,
    teamId: isTeamProject ? linkedProject.org.id : void 0,
    teamSlug: isTeamProject ? linkedProject.org.slug : void 0
  };
}
function buildEventsQuery(params) {
  const query = new URLSearchParams({
    limit: String(params.limit + 1)
  });
  if (params.types.length > 0) {
    query.set("types", params.types.join(","));
  }
  if (params.since) {
    query.set("since", params.since.toISOString());
  }
  if (params.until) {
    query.set("until", params.until.toISOString());
  }
  if (params.scope.projectIds && params.scope.projectIds.length > 0) {
    query.set("projectIds", params.scope.projectIds.join(","));
  }
  if (params.scope.teamId) {
    query.set("teamId", params.scope.teamId);
  }
  if (params.scope.teamSlug) {
    query.set("slug", params.scope.teamSlug);
  }
  if (params.jsonOutput) {
    query.set("withPayload", "true");
  }
  return query;
}
function paginateEvents(allEvents, limit) {
  const events = allEvents.slice(0, limit);
  const hasMore = allEvents.length > limit;
  const lastVisibleEvent = events[events.length - 1];
  const next = hasMore && typeof lastVisibleEvent?.createdAt === "number" ? lastVisibleEvent.createdAt - 1 : null;
  return { events, next };
}
function printScopeHeader(scope) {
  if (!scope.projectName && scope.teamSlug) {
    output_manager_default.log(`Showing all activity for team ${import_chalk.default.bold(scope.teamSlug)}`);
  } else if (scope.projectName && scope.teamSlug) {
    output_manager_default.log(
      `Showing activity for project ${import_chalk.default.bold(scope.projectName)} in team ${import_chalk.default.bold(scope.teamSlug)}`
    );
  } else if (scope.projectName) {
    output_manager_default.log(`Showing activity for project ${import_chalk.default.bold(scope.projectName)}`);
  }
}
function printNextPageHint(flags, next) {
  const commandFlags = getCommandFlags(flags, ["--next"]);
  output_manager_default.log(
    `To display the next page, run ${getCommandName(
      `activity${commandFlags} --next ${next}`
    )}`
  );
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
  const normalizedTypes = normalizeRepeatableStringFilters(flags["--type"]);
  trackTelemetry(flags, normalizedTypes, telemetry);
  const validatedInputs = resolveValidatedInputs(
    flags,
    jsonOutput,
    client,
    normalizedTypes
  );
  if (typeof validatedInputs === "number") {
    return validatedInputs;
  }
  const scope = await resolveScope(client, {
    project: flags["--project"],
    all: flags["--all"],
    jsonOutput
  });
  if (typeof scope === "number") {
    return scope;
  }
  const query = buildEventsQuery({
    limit: validatedInputs.limit,
    types: validatedInputs.types,
    since: validatedInputs.since,
    until: validatedInputs.until,
    scope,
    jsonOutput
  });
  output_manager_default.spinner("Fetching activity...");
  try {
    const response = await client.fetch(
      `/v3/events?${query.toString()}`,
      {
        useCurrentTeam: false
      }
    );
    const allEvents = Array.isArray(response.events) ? response.events : [];
    const { events, next } = paginateEvents(allEvents, validatedInputs.limit);
    if (jsonOutput) {
      const hasScope = scope.teamSlug || scope.projectName;
      const jsonResponse = {
        ...hasScope && {
          scope: {
            ...scope.teamSlug && { teamSlug: scope.teamSlug },
            ...scope.projectName && { projectName: scope.projectName },
            ...scope.projectIds && { projectIds: scope.projectIds }
          }
        },
        events,
        pagination: { next }
      };
      client.stdout.write(`${JSON.stringify(jsonResponse, null, 2)}
`);
      return 0;
    }
    printScopeHeader(scope);
    if (events.length === 0) {
      output_manager_default.log("No activity events found.");
      return 0;
    }
    printExpandedEvents(events);
    if (next !== null) {
      printNextPageHint(flags, next);
    }
    return 0;
  } catch (err) {
    if (isAPIError(err)) {
      return handleApiError(err, jsonOutput, client);
    }
    throw err;
  } finally {
    output_manager_default.stopSpinner();
  }
}
export {
  list as default
};
