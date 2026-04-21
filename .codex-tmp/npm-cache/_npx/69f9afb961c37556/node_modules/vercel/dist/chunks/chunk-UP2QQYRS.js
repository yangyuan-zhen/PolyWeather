import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  outputError
} from "./chunk-HTOH3MSD.js";
import {
  getScope
} from "./chunk-CUCRUPRY.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import {
  getLinkedProject,
  getProjectByNameOrId
} from "./chunk-U7MQBM3F.js";
import {
  buildCommandWithGlobalFlags,
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import {
  ProjectNotFound,
  isAPIError
} from "./chunk-ECRBC4HL.js";

// src/commands/alerts/resolve-alerts-scope.ts
function emitAlertsScopeError(client, jsonOutput, code, message, agent) {
  outputAgentError(
    client,
    {
      status: "error",
      reason: agent.reason,
      message,
      hint: agent.hint,
      next: agent.next
    },
    1
  );
  return outputError(client, jsonOutput, code, message);
}
async function resolveAlertsScope(client, opts) {
  if (opts.all || opts.project) {
    const { team } = await getScope(client);
    if (!team) {
      const msg = "No team context found. Run `vercel switch` to select a team, or use `vercel link` in a project directory.";
      return emitAlertsScopeError(client, opts.jsonOutput, "NO_TEAM", msg, {
        reason: AGENT_REASON.MISSING_SCOPE,
        hint: "Select a team scope before using --project or --all with alerts.",
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
    if (opts.all) {
      return {
        teamId: team.id
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
        const msg = err.serverMessage || (err.status === 403 ? `You do not have permission to access project "${opts.project}" in team "${team.slug}".` : `API error (${err.status}).`);
        const reason = err.status === 401 ? "not_authorized" : err.status === 403 ? "forbidden" : AGENT_REASON.API_ERROR;
        return emitAlertsScopeError(
          client,
          opts.jsonOutput,
          err.code || "API_ERROR",
          msg,
          {
            reason,
            next: [
              {
                command: buildCommandWithGlobalFlags(
                  client.argv,
                  "alerts rules ls --project <name_or_id>"
                ),
                when: "Retry with a project you can access (replace <name_or_id>)"
              }
            ]
          }
        );
      }
      throw err;
    }
    if (projectResult instanceof ProjectNotFound) {
      const msg = `Project "${opts.project}" was not found in team "${team.slug}".`;
      return emitAlertsScopeError(
        client,
        opts.jsonOutput,
        "PROJECT_NOT_FOUND",
        msg,
        {
          reason: AGENT_REASON.NOT_FOUND,
          next: [
            {
              command: buildCommandWithGlobalFlags(
                client.argv,
                "alerts rules ls"
              ),
              when: "List rules in the current linked project or adjust --project"
            }
          ]
        }
      );
    }
    return {
      teamId: team.id,
      projectId: projectResult.id
    };
  }
  const linkedProject = await getLinkedProject(client);
  if (linkedProject.status === "error") {
    return linkedProject.exitCode;
  }
  if (linkedProject.status === "not_linked") {
    const msg = "No linked project found. Run `vercel link` to link a project, or use --project <name> or --all.";
    return emitAlertsScopeError(client, opts.jsonOutput, "NOT_LINKED", msg, {
      reason: AGENT_REASON.NOT_LINKED,
      hint: "Agents should pass --project or --all when no .vercel link exists in --cwd.",
      next: [
        {
          command: buildCommandWithGlobalFlags(client.argv, "link"),
          when: "Link this directory to a Vercel project"
        },
        {
          command: buildCommandWithGlobalFlags(
            client.argv,
            "alerts rules ls --project <name_or_id>"
          ),
          when: "List rules for a project without linking (replace <name_or_id>)"
        },
        {
          command: buildCommandWithGlobalFlags(
            client.argv,
            "alerts rules ls --all"
          ),
          when: "List team-wide rules without a linked project"
        }
      ]
    });
  }
  return {
    teamId: linkedProject.org.id,
    projectId: linkedProject.project.id
  };
}

export {
  emitAlertsScopeError,
  resolveAlertsScope
};
