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
  outputError,
  validateAllProjectMutualExclusivity
} from "./chunk-HTOH3MSD.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import {
  buildCommandWithGlobalFlags,
  outputAgentError
} from "./chunk-XKHLPA6V.js";

// src/commands/alerts/rules/parse-scope.ts
async function parseRulesFlagsAndScope(client, flags, jsonOutput) {
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
              "alerts rules --help"
            ),
            when: "Use either `--project` or `--all`, not both"
          }
        ]
      },
      1
    );
    return handleValidationError(mutual, jsonOutput, client);
  }
  return resolveAlertsScope(client, {
    project: flags["--project"],
    all: flags["--all"],
    jsonOutput
  });
}

// src/commands/alerts/rules/util.ts
function buildRulesQuery(scope) {
  const query = new URLSearchParams({ teamId: scope.teamId });
  if (scope.projectId) {
    query.set("projectId", scope.projectId);
  }
  return query;
}
function rulesCollectionPath(scope) {
  return `/alerts/v2/alert-rules?${buildRulesQuery(scope).toString()}`;
}
function rulesItemPath(scope, ruleId) {
  const query = new URLSearchParams({ teamId: scope.teamId });
  return `/alerts/v2/alert-rules/${encodeURIComponent(ruleId)}?${query.toString()}`;
}
function handleRulesApiError(client, err, jsonOutput) {
  const message = err.status === 401 || err.status === 403 ? "You do not have access to alert rules in this scope. Ensure your role can manage Alert Rules, or pass --token and --scope." : err.status >= 500 ? `The alert rules endpoint failed (${err.status}). Re-run with --debug and share the x-vercel-id from the failed request.` : err.serverMessage || `API error (${err.status}).`;
  const reason = err.status === 401 ? "not_authorized" : err.status === 403 ? "forbidden" : err.status === 404 ? AGENT_REASON.NOT_FOUND : err.status === 429 ? "rate_limited" : AGENT_REASON.API_ERROR;
  outputAgentError(
    client,
    {
      status: "error",
      reason,
      message,
      ...err.status === 401 || err.status === 403 ? {
        hint: "Confirm team scope with whoami; use --scope <team-slug> if the rule lives under another team.",
        next: [
          {
            command: buildCommandWithGlobalFlags(client.argv, "whoami"),
            when: "See current user and team"
          },
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts rules ls"
            ),
            when: "Retry listing rules after fixing scope or permissions"
          }
        ]
      } : {}
    },
    1
  );
  return outputError(client, jsonOutput, err.code || "API_ERROR", message);
}
function emitRulesArgParseError(client, err, recoverWithProjectFlag) {
  const msg = err instanceof Error ? err.message : String(err);
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
            recoverWithProjectFlag
          ),
          when: "Re-run with a project name or id (replace placeholder)"
        }
      ] : [
        {
          command: buildCommandWithGlobalFlags(
            client.argv,
            "alerts rules --help"
          ),
          when: "See valid `alerts rules` subcommands"
        }
      ]
    },
    1
  );
}

export {
  parseRulesFlagsAndScope,
  rulesCollectionPath,
  rulesItemPath,
  handleRulesApiError,
  emitRulesArgParseError
};
