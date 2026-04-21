import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  emitAlertsScopeError
} from "./chunk-UP2QQYRS.js";
import {
  handleValidationError,
  outputError,
  validateAllProjectMutualExclusivity
} from "./chunk-HTOH3MSD.js";
import {
  getScope
} from "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  inspectSubcommand
} from "./chunk-TAOVG4PS.js";
import "./chunk-DVQ4SIWF.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import {
  getLinkedProject,
  getProjectByNameOrId
} from "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  buildCommandWithGlobalFlags,
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  ProjectNotFound,
  isAPIError,
  packageName
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

// src/commands/alerts/inspect.ts
var import_chalk = __toESM(require_source(), 1);
async function resolveInspectScope(client, flags, jsonOutput) {
  const mutual = validateAllProjectMutualExclusivity(
    flags["--all"],
    flags["--project"]
  );
  if (!mutual.valid) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.INVALID_ARGUMENTS,
        message: mutual.message,
        next: [
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts inspect <groupId> --help"
            ),
            when: "Use either `--project` or `--all`, not both"
          }
        ]
      },
      1
    );
    return handleValidationError(mutual, jsonOutput, client);
  }
  if (flags["--all"]) {
    const { team } = await getScope(client);
    if (!team) {
      const msg = "No team context found. Run `vercel switch` to select a team, or use `vercel link`.";
      return emitAlertsScopeError(client, jsonOutput, "NO_TEAM", msg, {
        reason: AGENT_REASON.MISSING_SCOPE,
        next: [
          {
            command: buildCommandWithGlobalFlags(client.argv, "whoami"),
            when: "See current user and team"
          },
          {
            command: buildCommandWithGlobalFlags(client.argv, "teams switch"),
            when: "Switch to a team that owns the project"
          }
        ]
      });
    }
    return { teamId: team.id };
  }
  if (flags["--project"]) {
    const { team } = await getScope(client);
    if (!team) {
      const msg = "No team context found. Run `vercel switch` to select a team.";
      return emitAlertsScopeError(client, jsonOutput, "NO_TEAM", msg, {
        reason: AGENT_REASON.MISSING_SCOPE,
        next: [
          {
            command: buildCommandWithGlobalFlags(client.argv, "whoami"),
            when: "See current user and team"
          },
          {
            command: buildCommandWithGlobalFlags(client.argv, "teams switch"),
            when: "Switch to a team that owns the project"
          }
        ]
      });
    }
    try {
      const p = await getProjectByNameOrId(client, flags["--project"], team.id);
      if (p instanceof ProjectNotFound) {
        const msg = `Project "${flags["--project"]}" was not found.`;
        return emitAlertsScopeError(
          client,
          jsonOutput,
          "PROJECT_NOT_FOUND",
          msg,
          {
            reason: AGENT_REASON.NOT_FOUND,
            next: [
              {
                command: buildCommandWithGlobalFlags(
                  client.argv,
                  "alerts inspect <groupId> --project <name_or_id>"
                ),
                when: "Retry with a valid project (replace placeholders)"
              }
            ]
          }
        );
      }
      return { teamId: team.id, projectId: p.id };
    } catch (err) {
      if (isAPIError(err)) {
        const msg = err.serverMessage || (err.status === 403 ? `You do not have permission to access project "${flags["--project"]}" in team "${team.slug}".` : `API error (${err.status}).`);
        const reason = err.status === 401 ? "not_authorized" : err.status === 403 ? "forbidden" : AGENT_REASON.API_ERROR;
        return emitAlertsScopeError(
          client,
          jsonOutput,
          err.code || "API_ERROR",
          msg,
          {
            reason,
            next: [
              {
                command: buildCommandWithGlobalFlags(
                  client.argv,
                  "alerts inspect <groupId> --project <name_or_id>"
                ),
                when: "Retry with a project you can access"
              }
            ]
          }
        );
      }
      throw err;
    }
  }
  const linked = await getLinkedProject(client);
  if (linked.status === "error") {
    return linked.exitCode;
  }
  if (linked.status === "not_linked") {
    const msg = "No linked project. Run `vercel link` or pass --project <name> or --all.";
    return emitAlertsScopeError(client, jsonOutput, "NOT_LINKED", msg, {
      reason: AGENT_REASON.NOT_LINKED,
      next: [
        {
          command: buildCommandWithGlobalFlags(client.argv, "link"),
          when: "Link this directory to a Vercel project"
        },
        {
          command: buildCommandWithGlobalFlags(
            client.argv,
            "alerts inspect <groupId> --project <name_or_id>"
          ),
          when: "Inspect using an explicit project"
        },
        {
          command: buildCommandWithGlobalFlags(
            client.argv,
            "alerts inspect <groupId> --all"
          ),
          when: "Inspect using team-wide scope"
        }
      ]
    });
  }
  return {
    teamId: linked.org.id,
    projectId: linked.project.id
  };
}
async function inspect(client, argv) {
  let parsedArgs;
  const spec = getFlagsSpecification(inspectSubcommand.options);
  try {
    parsedArgs = parseArguments(argv, spec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const projectFlagMissingArg = msg.includes("--project") && msg.includes("requires argument");
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
              "alerts inspect <groupId> --project <name-or-id>"
            ),
            when: "Re-run with placeholders replaced"
          }
        ] : [
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts inspect --help"
            ),
            when: "See valid `alerts inspect` usage"
          }
        ]
      },
      1
    );
    printError(e);
    return 1;
  }
  const groupId = parsedArgs.args[0];
  const fr = validateJsonOutput(parsedArgs.flags);
  if (!fr.valid) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.INVALID_ARGUMENTS,
        message: fr.error
      },
      1
    );
    output_manager_default.error(fr.error);
    return 1;
  }
  if (!groupId) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.MISSING_ARGUMENTS,
        message: `Missing group id. Example: ${packageName} alerts inspect <groupId>`,
        next: [
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts inspect <groupId>"
            ),
            when: "Replace <groupId> with a group id from `vercel alerts`"
          }
        ]
      },
      1
    );
    return outputError(
      client,
      fr.jsonOutput,
      "MISSING_ARGUMENTS",
      "Usage: `vercel alerts inspect <groupId>`"
    );
  }
  const scope = await resolveInspectScope(
    client,
    {
      "--project": parsedArgs.flags["--project"],
      "--all": parsedArgs.flags["--all"]
    },
    fr.jsonOutput
  );
  if (typeof scope === "number") {
    return scope;
  }
  const query = new URLSearchParams({ teamId: scope.teamId });
  if (scope.projectId) {
    query.set("projectId", scope.projectId);
  }
  const path = `/alerts/v3/groups/${encodeURIComponent(groupId)}?${query.toString()}`;
  output_manager_default.spinner("Fetching alert group...");
  try {
    const group = await client.fetch(path);
    if (fr.jsonOutput) {
      client.stdout.write(`${JSON.stringify({ group }, null, 2)}
`);
    } else {
      output_manager_default.log(`${import_chalk.default.bold("Alert group")} ${import_chalk.default.cyan(groupId)}`);
      client.stdout.write(`${JSON.stringify(group, null, 2)}
`);
    }
    return 0;
  } catch (err) {
    if (isAPIError(err)) {
      const msg = err.serverMessage || `API error (${err.status}).`;
      const reason = err.status === 401 ? "not_authorized" : err.status === 403 ? "forbidden" : err.status === 404 ? AGENT_REASON.NOT_FOUND : err.status === 429 ? "rate_limited" : AGENT_REASON.API_ERROR;
      outputAgentError(
        client,
        {
          status: "error",
          reason,
          message: msg,
          ...err.status === 401 || err.status === 403 ? {
            hint: "Confirm team scope; use --scope <team-slug> if the group belongs to another team.",
            next: [
              {
                command: buildCommandWithGlobalFlags(client.argv, "whoami"),
                when: "See current user and team"
              },
              {
                command: buildCommandWithGlobalFlags(
                  client.argv,
                  `alerts inspect ${groupId}`
                ),
                when: "Retry after fixing scope or permissions"
              }
            ]
          } : {}
        },
        1
      );
      return outputError(client, fr.jsonOutput, err.code || "API_ERROR", msg);
    }
    throw err;
  } finally {
    output_manager_default.stopSpinner();
  }
}
export {
  inspect as default
};
