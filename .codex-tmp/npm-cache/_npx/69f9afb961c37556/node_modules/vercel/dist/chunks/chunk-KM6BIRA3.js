import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  AGENT_REASON,
  AGENT_STATUS
} from "./chunk-E3NE4SKN.js";
import {
  getLinkedProject
} from "./chunk-U7MQBM3F.js";
import {
  buildCommandWithYes,
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import {
  getFlagsSpecification,
  getGlobalFlagsOnlyFromArgs,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  getCommandName,
  getCommandNamePlain
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

// src/util/routes/types.ts
var ROUTE_TYPE_LABELS = {
  rewrite: "Rewrite",
  redirect: "Redirect",
  set_status: "Set Status",
  transform: "Transform"
};
function getRouteTypeLabel(rule) {
  if (!rule.routeType)
    return "-";
  return ROUTE_TYPE_LABELS[rule.routeType] ?? "-";
}
var SRC_SYNTAX_LABELS = {
  equals: "Exact Match",
  "path-to-regexp": "Pattern",
  regex: "Regex"
};
function getSrcSyntaxLabel(rule) {
  const syntax = rule.srcSyntax ?? "regex";
  return SRC_SYNTAX_LABELS[syntax];
}

// src/commands/routes/shared.ts
var import_chalk = __toESM(require_source(), 1);
function withGlobalFlags(client, commandTemplate) {
  const flags = getGlobalFlagsOnlyFromArgs(client.argv.slice(2));
  return getCommandNamePlain(`${commandTemplate} ${flags.join(" ")}`.trim());
}
function shellQuoteRouteIdentifierForSuggestion(identifier) {
  if (!identifier.includes(" ")) {
    return identifier;
  }
  if (!identifier.includes("'")) {
    return `'${identifier}'`;
  }
  if (!identifier.includes('"')) {
    return `"${identifier}"`;
  }
  return `"${identifier.replace(/"/g, '\\"')}"`;
}
async function parseSubcommandArgs(argv, command, client) {
  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(command.options);
  try {
    parsedArgs = parseArguments(argv, flagsSpecification);
  } catch (err) {
    if (client?.nonInteractive) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const flags = getGlobalFlagsOnlyFromArgs(client.argv.slice(2));
      let message = rawMessage;
      let next = [
        {
          command: getCommandNamePlain(
            `routes ${command.name} ${flags.join(" ")}`.trim()
          ),
          when: "fix flags and retry"
        }
      ];
      const aiIdx = argv.indexOf("--ai");
      const aiMissingValue = aiIdx !== -1 && (aiIdx === argv.length - 1 || argv[aiIdx + 1] !== void 0 && argv[aiIdx + 1].startsWith("-"));
      const isAiArgError = aiMissingValue || /option requires argument.*--ai|--ai.*requires argument/i.test(
        rawMessage
      );
      if (isAiArgError && (command.name === "add" || command.name === "edit")) {
        message = command.name === "add" ? '--ai requires a description. Example: routes add --ai <description> --yes --non-interactive. Replace <description> with your text; use shell quotes if it contains spaces (e.g. --ai "Redirect /old to /new").' : "--ai requires a description. Example: routes edit <name-or-id> --ai <description> --yes --non-interactive. Replace placeholders; use shell quotes for <description> if it contains spaces.";
        next = [
          {
            command: withGlobalFlags(
              client,
              command.name === "add" ? `routes add --ai <description> --yes` : `routes edit <name-or-id> --ai <description> --yes`
            ),
            when: "replace <description> with your text (quote it in the shell if it contains spaces), then run"
          },
          {
            command: getCommandNamePlain(
              `routes ${command.name} --help ${flags.join(" ")}`.trim()
            ),
            when: "see all flags"
          }
        ];
      }
      outputAgentError(
        client,
        {
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.INVALID_ARGUMENTS,
          message,
          next
        },
        1
      );
      return 1;
    }
    printError(err);
    return 1;
  }
  return parsedArgs;
}
async function ensureProjectLink(client) {
  const link = await getLinkedProject(client);
  if (link.status === "error") {
    return link.exitCode;
  } else if (link.status === "not_linked") {
    if (client.nonInteractive) {
      const flags = getGlobalFlagsOnlyFromArgs(client.argv.slice(2));
      const cmd = getCommandNamePlain(`link ${flags.join(" ")}`.trim());
      outputAgentError(
        client,
        {
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.NOT_LINKED,
          userActionRequired: true,
          message: "Your codebase is not linked to a Vercel project. Run link first, then retry routes commands.",
          next: [
            {
              command: cmd,
              when: "to link this directory to a project"
            }
          ]
        },
        1
      );
      return 1;
    }
    output_manager_default.error(
      `Your codebase isn't linked to a project on Vercel. Run ${getCommandName("link")} to begin.`
    );
    return 1;
  }
  client.config.currentTeam = link.org.type === "team" ? link.org.id : void 0;
  return link;
}
async function confirmAction(client, skipConfirmation, message, details) {
  if (skipConfirmation)
    return true;
  if (client.nonInteractive) {
    outputAgentError(client, {
      status: AGENT_STATUS.ERROR,
      reason: AGENT_REASON.CONFIRMATION_REQUIRED,
      message: `${message} Re-run with --yes to confirm.`,
      next: [
        {
          command: buildCommandWithYes(client.argv),
          when: "re-run with --yes to confirm"
        }
      ]
    });
    process.exit(1);
    return false;
  }
  if (details) {
    output_manager_default.print(`  ${details}
`);
  }
  return await client.input.confirm(message, false);
}
function validateRequiredArgs(args, required) {
  for (let i = 0; i < required.length; i++) {
    if (!args[i]) {
      return `Missing required argument: ${required[i]}`;
    }
  }
  return null;
}
function formatCondition(condition) {
  const parts = [import_chalk.default.gray(`[${condition.type}]`)];
  if (condition.key) {
    parts.push(import_chalk.default.cyan(condition.key));
  }
  if (condition.value !== void 0) {
    const formatted = typeof condition.value === "string" ? condition.value : JSON.stringify(condition.value);
    parts.push(condition.key ? `= ${formatted}` : formatted);
  }
  return parts.join(" ");
}
var TRANSFORM_TYPE_LABELS = {
  "request.headers": "Request Header",
  "request.query": "Request Query",
  "response.headers": "Response Header"
};
var TRANSFORM_OP_LABELS = {
  set: "set",
  append: "append",
  delete: "delete"
};
function formatTransform(transform, includeType = true) {
  const opLabel = TRANSFORM_OP_LABELS[transform.op] ?? transform.op;
  const key = typeof transform.target.key === "string" ? transform.target.key : JSON.stringify(transform.target.key);
  const parts = [];
  if (includeType) {
    const typeLabel = TRANSFORM_TYPE_LABELS[transform.type] ?? transform.type;
    parts.push(import_chalk.default.gray(`[${typeLabel}]`));
  }
  parts.push(import_chalk.default.yellow(opLabel), import_chalk.default.cyan(key));
  if (transform.args !== void 0 && transform.op !== "delete") {
    const argsStr = Array.isArray(transform.args) ? transform.args.join(", ") : transform.args;
    parts.push(`= ${argsStr}`);
  }
  return parts.join(" ");
}
function parsePosition(position) {
  if (position === "start") {
    return { placement: "start" };
  }
  if (position === "end") {
    return { placement: "end" };
  }
  if (position.startsWith("after:")) {
    const referenceId = position.slice(6);
    if (!referenceId) {
      throw new Error('Position "after:" requires a route ID');
    }
    return { placement: "after", referenceId };
  }
  if (position.startsWith("before:")) {
    const referenceId = position.slice(7);
    if (!referenceId) {
      throw new Error('Position "before:" requires a route ID');
    }
    return { placement: "before", referenceId };
  }
  throw new Error(
    `Invalid position: "${position}". Use: start, end, after:<id>, or before:<id>`
  );
}
async function offerAutoPromote(client, projectId, version, hadExistingStagingVersion, opts) {
  const { default: updateRouteVersion } = await import("./update-route-version-E3V47KNI.js");
  const { default: stamp } = await import("./stamp-ENIXDCRO.js");
  output_manager_default.print(
    `
  ${import_chalk.default.gray(`This change is staged. Run ${import_chalk.default.cyan(getCommandName("routes publish"))} to make it live, or ${import_chalk.default.cyan(getCommandName("routes discard-staging"))} to undo.`)}
`
  );
  if (!hadExistingStagingVersion && !opts.skipPrompts) {
    output_manager_default.print("\n");
    const shouldPromote = await client.input.confirm(
      "This is the only staged change. Promote to production now?",
      false
    );
    if (shouldPromote) {
      const promoteStamp = stamp();
      output_manager_default.spinner("Promoting to production");
      try {
        await updateRouteVersion(client, projectId, version.id, "promote", {
          teamId: opts.teamId
        });
        output_manager_default.log(
          `${import_chalk.default.cyan("Promoted")} to production ${import_chalk.default.gray(promoteStamp())}`
        );
      } catch (e) {
        const err = e;
        output_manager_default.error(
          `Failed to promote to production: ${err.message || "Unknown error"}`
        );
      }
    }
  } else if (hadExistingStagingVersion) {
    output_manager_default.warn(
      `There are other staged changes. Review with ${import_chalk.default.cyan(getCommandName("routes list --diff"))} before promoting.`
    );
  }
}
function printDiffSummary(routes, maxDisplay = 10) {
  const displayRoutes = routes.slice(0, maxDisplay);
  for (const route of displayRoutes) {
    const symbol = getDiffSymbol(route);
    const label = getDiffLabel(route);
    const routeType = getRouteTypeLabel(route);
    output_manager_default.print(
      `  ${symbol} ${route.name}${routeType !== "-" ? ` ${import_chalk.default.gray(`(${routeType})`)}` : ""} ${import_chalk.default.gray(`- ${label}`)}
`
    );
  }
  if (routes.length > maxDisplay) {
    output_manager_default.print(
      import_chalk.default.gray(`
  ... and ${routes.length - maxDisplay} more changes
`)
    );
  }
}
function getDiffSymbol(route) {
  if (route.action === "+")
    return import_chalk.default.green("+");
  if (route.action === "-")
    return import_chalk.default.red("-");
  return import_chalk.default.yellow("~");
}
function getDiffLabel(route) {
  if (route.action === "+")
    return "Added";
  if (route.action === "-")
    return "Deleted";
  const isReordered = route.previousIndex !== void 0 && route.newIndex !== void 0;
  if (isReordered) {
    return `Reordered (${route.previousIndex + 1} \u2192 ${route.newIndex + 1})`;
  }
  if (route.previousEnabled !== void 0) {
    return route.enabled === false ? "Disabled" : "Enabled";
  }
  return "Modified";
}
async function resolveRoute(client, routes, identifier) {
  const byId = routes.find((r) => r.id === identifier);
  if (byId)
    return byId;
  const query = identifier.toLowerCase();
  const matches = routes.filter(
    (r) => r.name.toLowerCase() === query || r.name.toLowerCase().includes(query) || r.id.toLowerCase().includes(query)
  );
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (client.nonInteractive) {
    outputAgentError(
      client,
      {
        status: AGENT_STATUS.ERROR,
        reason: AGENT_REASON.AMBIGUOUS_ROUTE,
        message: `Multiple routes match "${identifier}" (${matches.length} matches). Pass an exact route name or ID.`,
        next: [
          {
            command: withGlobalFlags(client, "routes list"),
            when: "list routes to get exact id"
          }
        ]
      },
      1
    );
    return null;
  }
  const selectedId = await client.input.select({
    message: `Multiple routes match "${identifier}". Select one:`,
    choices: matches.map((route) => ({
      value: route.id,
      name: `${route.name} ${import_chalk.default.gray(`(${route.route.src})`)}`
    }))
  });
  return matches.find((r) => r.id === selectedId) ?? null;
}
async function resolveRoutes(client, routes, identifiers) {
  const resolved = /* @__PURE__ */ new Map();
  for (const identifier of identifiers) {
    const route = await resolveRoute(client, routes, identifier);
    if (!route) {
      if (client.nonInteractive) {
        outputAgentError(
          client,
          {
            status: AGENT_STATUS.ERROR,
            reason: AGENT_REASON.NOT_FOUND,
            message: `No route found matching "${identifier}".`,
            next: [
              {
                command: withGlobalFlags(client, "routes list"),
                when: "list routes"
              }
            ]
          },
          1
        );
        return null;
      }
      output_manager_default.error(
        `No route found matching "${identifier}". Run ${import_chalk.default.cyan(
          getCommandName("routes list")
        )} to see all routes.`
      );
      return null;
    }
    resolved.set(route.id, route);
  }
  return Array.from(resolved.values());
}
function findVersionById(versions, identifier) {
  const matchingVersions = versions.filter((v) => v.id.startsWith(identifier));
  if (matchingVersions.length === 0) {
    return {
      error: `Version "${identifier}" not found. Run ${import_chalk.default.cyan(
        getCommandName("routes list-versions")
      )} to see available versions.`
    };
  }
  if (matchingVersions.length > 1) {
    return {
      error: `Multiple versions match "${identifier}". Please provide a more specific ID:
${matchingVersions.map((v) => `  ${v.id}`).join("\n")}`
    };
  }
  return { version: matchingVersions[0] };
}

// src/util/routes/get-routes.ts
async function getRoutes(client, projectId, options = {}) {
  const { teamId, search, filter, versionId, diff } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  if (search)
    query.set("q", search);
  if (filter)
    query.set("filter", filter);
  if (versionId)
    query.set("versionId", versionId);
  if (diff)
    query.set("diff", "true");
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes${queryString ? `?${queryString}` : ""}`;
  const response = await client.fetch(url);
  return response;
}

export {
  getRouteTypeLabel,
  getSrcSyntaxLabel,
  withGlobalFlags,
  shellQuoteRouteIdentifierForSuggestion,
  parseSubcommandArgs,
  ensureProjectLink,
  confirmAction,
  validateRequiredArgs,
  formatCondition,
  TRANSFORM_TYPE_LABELS,
  formatTransform,
  parsePosition,
  offerAutoPromote,
  printDiffSummary,
  resolveRoute,
  resolveRoutes,
  findVersionById,
  getRoutes
};
