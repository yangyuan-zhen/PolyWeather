import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  getRouteVersions
} from "./chunk-AHU7WNL2.js";
import {
  ensureProjectLink,
  getRoutes,
  offerAutoPromote,
  parsePosition,
  parseSubcommandArgs,
  resolveRoute,
  shellQuoteRouteIdentifierForSuggestion,
  withGlobalFlags
} from "./chunk-KM6BIRA3.js";
import {
  reorderSubcommand
} from "./chunk-CRZM5WM2.js";
import "./chunk-E3NE4SKN.js";
import "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import {
  stamp_default
} from "./chunk-CO5D46AG.js";
import "./chunk-RFMC2QXQ.js";
import {
  getCommandName
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

// src/commands/routes/reorder.ts
var import_chalk = __toESM(require_source(), 1);

// src/util/routes/stage-routes.ts
async function stageRoutes(client, projectId, routes, overwrite, options = {}) {
  const { teamId } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes${queryString ? `?${queryString}` : ""}`;
  return await client.fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ routes, overwrite })
  });
}

// src/commands/routes/reorder.ts
async function reorder(client, argv) {
  const parsed = await parseSubcommandArgs(argv, reorderSubcommand, client);
  if (typeof parsed === "number")
    return parsed;
  const link = await ensureProjectLink(client);
  if (typeof link === "number")
    return link;
  const { project, org } = link;
  const teamId = org.type === "team" ? org.id : void 0;
  const { args, flags } = parsed;
  const skipConfirmation = flags["--yes"];
  const identifier = args[0];
  if (!identifier) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "missing_arguments",
          message: "Route name or ID and position are required.",
          next: [
            {
              command: withGlobalFlags(
                client,
                "routes reorder <name-or-id> --position <pos> --yes"
              ),
              when: "replace placeholders; --first/--last or numeric position"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error(
      `Route name or ID is required. Usage: ${getCommandName("routes reorder <name-or-id> --position <pos>")}`
    );
    return 1;
  }
  const { versions } = await getRouteVersions(client, project.id, { teamId });
  const existingStagingVersion = versions.find((v) => v.isStaging);
  output_manager_default.spinner("Fetching routes");
  const { routes } = await getRoutes(client, project.id, { teamId });
  output_manager_default.stopSpinner();
  if (routes.length === 0) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "not_found",
          message: "No routes found in this project."
        },
        1
      );
    }
    output_manager_default.error("No routes found in this project.");
    return 1;
  }
  if (routes.length === 1) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "invalid_arguments",
          message: "Cannot reorder when there is only one route."
        },
        1
      );
    }
    output_manager_default.error("Cannot reorder when there is only one route.");
    return 1;
  }
  const route = await resolveRoute(client, routes, identifier);
  if (!route) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "not_found",
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
    }
    output_manager_default.error(
      `No route found matching "${identifier}". Run ${import_chalk.default.cyan(
        getCommandName("routes list")
      )} to see all routes.`
    );
    return 1;
  }
  const currentIndex = routes.findIndex((r) => r.id === route.id);
  const currentPosition = currentIndex + 1;
  let targetIndex;
  const positionFlag = flags["--position"];
  const firstFlag = flags["--first"];
  const lastFlag = flags["--last"];
  if (firstFlag) {
    targetIndex = 0;
  } else if (lastFlag) {
    targetIndex = routes.length;
  } else if (positionFlag) {
    if (positionFlag === "first") {
      targetIndex = 0;
    } else if (positionFlag === "last") {
      targetIndex = routes.length;
    } else {
      const num = parseInt(positionFlag, 10);
      if (!isNaN(num) && String(num) === positionFlag) {
        if (num < 1) {
          const msg = "Position must be 1 or greater. Positions are 1-based (e.g. --position 1 for first). Use --first or --last instead of 0.";
          if (client.nonInteractive) {
            outputAgentError(
              client,
              {
                status: "error",
                reason: "invalid_arguments",
                message: msg,
                next: [
                  {
                    command: withGlobalFlags(
                      client,
                      `routes reorder ${shellQuoteRouteIdentifierForSuggestion(identifier)} --first --yes`
                    ),
                    when: "move to first position"
                  },
                  {
                    command: withGlobalFlags(
                      client,
                      `routes reorder ${shellQuoteRouteIdentifierForSuggestion(identifier)} --position 1 --yes`
                    ),
                    when: "same as first (1-based index)"
                  },
                  {
                    command: withGlobalFlags(
                      client,
                      `routes reorder ${shellQuoteRouteIdentifierForSuggestion(identifier)} --last --yes`
                    ),
                    when: "move to last position"
                  }
                ],
                hint: "Numeric --position uses 1-based indices; there is no position 0."
              },
              1
            );
            return 1;
          }
          output_manager_default.error(msg);
          return 1;
        }
        targetIndex = Math.min(num - 1, routes.length);
      } else {
        try {
          const pos = parsePosition(positionFlag);
          if (pos.placement === "start") {
            targetIndex = 0;
          } else if (pos.placement === "end") {
            targetIndex = routes.length;
          } else if (pos.placement === "after" && pos.referenceId) {
            const refIndex = routes.findIndex((r) => r.id === pos.referenceId);
            if (refIndex === -1) {
              output_manager_default.error(
                `Reference route "${pos.referenceId}" not found. Run ${import_chalk.default.cyan(
                  getCommandName("routes list")
                )} to see route IDs.`
              );
              return 1;
            }
            targetIndex = refIndex + 1;
          } else if (pos.placement === "before" && pos.referenceId) {
            const refIndex = routes.findIndex((r) => r.id === pos.referenceId);
            if (refIndex === -1) {
              output_manager_default.error(
                `Reference route "${pos.referenceId}" not found. Run ${import_chalk.default.cyan(
                  getCommandName("routes list")
                )} to see route IDs.`
              );
              return 1;
            }
            targetIndex = refIndex;
          } else {
            output_manager_default.error("Invalid position specification.");
            return 1;
          }
        } catch (e) {
          output_manager_default.error(
            `${e instanceof Error ? e.message : "Invalid position"}. Usage: ${getCommandName("routes reorder <name-or-id> --position <pos>")}`
          );
          return 1;
        }
      }
    }
  } else {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "missing_arguments",
          message: "Target position is required. Use --position <n|first|last|after:id|before:id> or --first / --last.",
          next: [
            {
              command: withGlobalFlags(
                client,
                `routes reorder ${shellQuoteRouteIdentifierForSuggestion(identifier)} --position <pos> --yes`
              ),
              when: "replace <pos> with numeric position or first/last"
            }
          ]
        },
        1
      );
    }
    output_manager_default.print("\n");
    output_manager_default.log("Current route order:");
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      const isCurrent = r.id === route.id;
      const prefix = isCurrent ? import_chalk.default.cyan("\u2192") : " ";
      const num = import_chalk.default.gray(`${i + 1}.`);
      const name = isCurrent ? import_chalk.default.bold(r.name) : r.name;
      const src = import_chalk.default.gray(`(${r.route.src})`);
      const marker = isCurrent ? import_chalk.default.cyan("  \u2190 current") : "";
      output_manager_default.print(`  ${prefix} ${num} ${name} ${src}${marker}
`);
    }
    output_manager_default.print("\n");
    const input = await client.input.text({
      message: `Move "${route.name}" to position (1-${routes.length}, "first", or "last"):`,
      validate: (val) => {
        if (!val)
          return "Position is required";
        if (val === "first" || val === "last")
          return true;
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > routes.length) {
          return `Enter a number between 1 and ${routes.length}, "first", or "last"`;
        }
        return true;
      }
    });
    if (input === "first") {
      targetIndex = 0;
    } else if (input === "last") {
      targetIndex = routes.length;
    } else {
      targetIndex = parseInt(input, 10) - 1;
    }
  }
  const adjustedTarget = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const clampedTarget = Math.max(
    0,
    Math.min(adjustedTarget, routes.length - 1)
  );
  if (currentIndex === clampedTarget) {
    output_manager_default.log(
      `Route "${route.name}" is already at position ${currentPosition}.`
    );
    return 0;
  }
  const finalPosition = clampedTarget + 1;
  if (!skipConfirmation) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "confirmation_required",
          message: "Reorder requires confirmation. Pass --yes in non-interactive mode.",
          next: [
            {
              command: withGlobalFlags(
                client,
                `routes reorder ${shellQuoteRouteIdentifierForSuggestion(identifier)} --position ${finalPosition} --yes`
              ),
              when: "re-run with --yes"
            }
          ]
        },
        1
      );
    }
    const confirmed = await client.input.confirm(
      `Move "${route.name}" from position ${currentPosition} to position ${finalPosition}?`,
      true
    );
    if (!confirmed) {
      output_manager_default.log("Aborted.");
      return 0;
    }
  }
  const reordered = [...routes];
  reordered.splice(currentIndex, 1);
  reordered.splice(clampedTarget, 0, route);
  const reorderStamp = stamp_default();
  output_manager_default.spinner(`Moving route "${route.name}"`);
  try {
    const { version } = await stageRoutes(
      client,
      project.id,
      reordered,
      true,
      // overwrite
      { teamId }
    );
    output_manager_default.log(
      `${import_chalk.default.cyan("Moved")} "${route.name}" from position ${currentPosition} to ${finalPosition} ${import_chalk.default.gray(reorderStamp())}`
    );
    await offerAutoPromote(
      client,
      project.id,
      version,
      !!existingStagingVersion,
      { teamId, skipPrompts: skipConfirmation }
    );
    return 0;
  } catch (e) {
    const error = e;
    output_manager_default.error(error.message || "Failed to reorder route");
    return 1;
  }
}
export {
  reorder as default
};
