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
  getRouteTypeLabel,
  getRoutes,
  offerAutoPromote,
  parseSubcommandArgs,
  resolveRoutes,
  withGlobalFlags
} from "./chunk-KM6BIRA3.js";
import {
  deleteSubcommand
} from "./chunk-CRZM5WM2.js";
import {
  AGENT_REASON,
  AGENT_STATUS
} from "./chunk-E3NE4SKN.js";
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

// src/commands/routes/delete.ts
var import_chalk = __toESM(require_source(), 1);

// src/util/routes/delete-routes.ts
async function deleteRoutes(client, projectId, routeIds, options = {}) {
  const { teamId } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes${queryString ? `?${queryString}` : ""}`;
  return await client.fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ routeIds })
  });
}

// src/commands/routes/delete.ts
async function deleteRoute(client, argv) {
  const parsed = await parseSubcommandArgs(argv, deleteSubcommand, client);
  if (typeof parsed === "number")
    return parsed;
  const link = await ensureProjectLink(client);
  if (typeof link === "number")
    return link;
  const { project, org } = link;
  const teamId = org.type === "team" ? org.id : void 0;
  const { args, flags } = parsed;
  const skipConfirmation = flags["--yes"];
  if (args.length === 0) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.MISSING_ARGUMENTS,
          message: "At least one route name or ID is required.",
          next: [
            {
              command: withGlobalFlags(
                client,
                "routes delete <name-or-id> --yes"
              ),
              when: "pass one or more ids/names and --yes to skip confirm"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error(
      `At least one route name or ID is required. Usage: ${getCommandName("routes delete <name-or-id> [...]")}`
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
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.NOT_FOUND,
          message: "No routes found in this project."
        },
        1
      );
    }
    output_manager_default.error("No routes found in this project.");
    return 1;
  }
  const resolved = await resolveRoutes(client, routes, args);
  if (!resolved)
    return 1;
  output_manager_default.print("\n");
  output_manager_default.log(
    `The following ${resolved.length === 1 ? "route" : `${resolved.length} routes`} will be deleted:`
  );
  for (const route of resolved) {
    const typeLabels = getRouteTypeLabel(route);
    output_manager_default.print(
      `  ${import_chalk.default.red("\xD7")} ${route.name} ${import_chalk.default.gray(`(${route.route.src})`)} ${import_chalk.default.gray(`[${typeLabels}]`)}
`
    );
  }
  output_manager_default.print("\n");
  if (!skipConfirmation) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.CONFIRMATION_REQUIRED,
          message: "Deletion requires confirmation. Pass --yes to skip the prompt in non-interactive mode.",
          next: [
            {
              command: withGlobalFlags(
                client,
                `routes delete ${args.join(" ")} --yes`
              ),
              when: "re-run with --yes to confirm without prompt"
            }
          ]
        },
        1
      );
    }
    const confirmed = await client.input.confirm(
      `Delete ${resolved.length === 1 ? "this route" : `these ${resolved.length} routes`}?`,
      false
    );
    if (!confirmed) {
      output_manager_default.log("Aborted.");
      return 0;
    }
  }
  const deleteStamp = stamp_default();
  output_manager_default.spinner(
    `Deleting ${resolved.length === 1 ? "route" : `${resolved.length} routes`}`
  );
  try {
    const { deletedCount, version } = await deleteRoutes(
      client,
      project.id,
      resolved.map((r) => r.id),
      { teamId }
    );
    output_manager_default.log(
      `${import_chalk.default.cyan("Deleted")} ${deletedCount} ${deletedCount === 1 ? "route" : "routes"} ${import_chalk.default.gray(deleteStamp())}`
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
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: AGENT_STATUS.ERROR,
          reason: AGENT_REASON.API_ERROR,
          message: "Failed to delete routes for this project. See hint for error details.",
          hint: error.message || "Retry with the same command once transient issues are resolved."
        },
        1
      );
    }
    output_manager_default.error(error.message || "Failed to delete routes");
    return 1;
  }
}
export {
  deleteRoute as default
};
