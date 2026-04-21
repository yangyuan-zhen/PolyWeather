import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  emitRulesArgParseError,
  handleRulesApiError,
  parseRulesFlagsAndScope,
  rulesItemPath
} from "./chunk-DQPDIHII.js";
import "./chunk-UP2QQYRS.js";
import "./chunk-HTOH3MSD.js";
import "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  rulesRmSubcommand
} from "./chunk-DVQ4SIWF.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  buildCommandWithGlobalFlags,
  buildCommandWithYes,
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  isAPIError,
  packageName
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import "./chunk-S7KYDPEM.js";
import "./chunk-TZ2YI2VH.js";

// src/commands/alerts/rules/rm.ts
async function rm(client, argv) {
  let parsedArgs;
  try {
    parsedArgs = parseArguments(
      argv,
      getFlagsSpecification(rulesRmSubcommand.options)
    );
  } catch (e) {
    emitRulesArgParseError(
      client,
      e,
      "alerts rules rm <ruleId> --project <name-or-id> --yes"
    );
    printError(e);
    return 1;
  }
  const ruleId = parsedArgs.args[0];
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
  if (!ruleId) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.MISSING_ARGUMENTS,
        message: `Missing rule id. Example: ${packageName} alerts rules rm <ruleId> --yes`,
        next: [
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts rules rm <ruleId> --yes"
            ),
            when: "Replace <ruleId> with an id from `alerts rules ls`"
          },
          {
            command: buildCommandWithGlobalFlags(
              client.argv,
              "alerts rules ls"
            ),
            when: "List rule ids in the current scope"
          }
        ]
      },
      1
    );
    output_manager_default.error("Usage: `vercel alerts rules rm <ruleId>`");
    return 1;
  }
  const skipConfirmation = Boolean(parsedArgs.flags["--yes"]);
  const scope = await parseRulesFlagsAndScope(
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
  if (!skipConfirmation) {
    outputAgentError(
      client,
      {
        status: "error",
        reason: AGENT_REASON.CONFIRMATION_REQUIRED,
        message: "Removing an alert rule requires confirmation. Re-run with --yes.",
        next: [{ command: buildCommandWithYes(client.argv) }]
      },
      1
    );
    if (!await client.input.confirm(
      `Delete alert rule ${ruleId}? This cannot be undone.`,
      false
    )) {
      output_manager_default.log("Canceled");
      return 0;
    }
  }
  const path = rulesItemPath(scope, ruleId);
  output_manager_default.spinner("Deleting alert rule...");
  try {
    await client.fetch(path, { method: "DELETE" });
    if (fr.jsonOutput) {
      client.stdout.write(
        `${JSON.stringify({ ok: true, ruleId, deleted: true }, null, 2)}
`
      );
    } else {
      output_manager_default.success(`Deleted alert rule ${ruleId}`);
    }
    return 0;
  } catch (err) {
    if (isAPIError(err)) {
      return handleRulesApiError(client, err, fr.jsonOutput);
    }
    throw err;
  } finally {
    output_manager_default.stopSpinner();
  }
}
export {
  rm as default
};
