import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  editRoute
} from "./chunk-P3SKP5WM.js";
import {
  getRouteVersions
} from "./chunk-AHU7WNL2.js";
import {
  ensureProjectLink,
  getRoutes,
  offerAutoPromote,
  parseSubcommandArgs,
  resolveRoute,
  withGlobalFlags
} from "./chunk-KM6BIRA3.js";
import {
  enableSubcommand
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

// src/commands/routes/enable.ts
var import_chalk = __toESM(require_source(), 1);
async function enable(client, argv) {
  const parsed = await parseSubcommandArgs(argv, enableSubcommand, client);
  if (typeof parsed === "number")
    return parsed;
  const link = await ensureProjectLink(client);
  if (typeof link === "number")
    return link;
  const { project, org } = link;
  const teamId = org.type === "team" ? org.id : void 0;
  const { args } = parsed;
  const identifier = args[0];
  if (!identifier) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "missing_arguments",
          message: "Route name or ID is required.",
          next: [
            {
              command: withGlobalFlags(client, "routes enable <name-or-id>"),
              when: "replace <name-or-id>"
            },
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
      `Route name or ID is required. Usage: ${getCommandName("routes enable <name-or-id>")}`
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
          message: "No routes found in this project.",
          next: [
            {
              command: withGlobalFlags(client, "routes add --help"),
              when: "add routes first"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error("No routes found in this project.");
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
  if (route.enabled !== false) {
    output_manager_default.log(`Route "${route.name}" is already enabled.`);
    return 0;
  }
  const enableStamp = stamp_default();
  output_manager_default.spinner(`Enabling route "${route.name}"`);
  try {
    const { version } = await editRoute(
      client,
      project.id,
      route.id,
      {
        route: {
          name: route.name,
          description: route.description,
          enabled: true,
          srcSyntax: route.srcSyntax,
          route: route.route
        }
      },
      { teamId }
    );
    output_manager_default.log(
      `${import_chalk.default.cyan("Enabled")} route "${route.name}" ${import_chalk.default.gray(enableStamp())}`
    );
    await offerAutoPromote(
      client,
      project.id,
      version,
      !!existingStagingVersion,
      { teamId }
    );
    return 0;
  } catch (e) {
    const error = e;
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "api_error",
          message: error.message || "Failed to enable route"
        },
        1
      );
    }
    output_manager_default.error(error.message || "Failed to enable route");
    return 1;
  }
}
export {
  enable as default
};
