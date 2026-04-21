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
  rulesCollectionPath
} from "./chunk-DQPDIHII.js";
import "./chunk-UP2QQYRS.js";
import "./chunk-HTOH3MSD.js";
import "./chunk-CUCRUPRY.js";
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  rulesLsSubcommand
} from "./chunk-DVQ4SIWF.js";
import {
  AGENT_REASON
} from "./chunk-E3NE4SKN.js";
import "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import "./chunk-CO5D46AG.js";
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
import "./chunk-S7KYDPEM.js";
import "./chunk-TZ2YI2VH.js";

// src/commands/alerts/rules/ls.ts
async function ls(client, argv) {
  let parsedArgs;
  try {
    parsedArgs = parseArguments(
      argv,
      getFlagsSpecification(rulesLsSubcommand.options)
    );
  } catch (e) {
    emitRulesArgParseError(client, e, "alerts rules ls --project <name-or-id>");
    printError(e);
    return 1;
  }
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
  const path = rulesCollectionPath(scope);
  output_manager_default.spinner("Fetching alert rules...");
  try {
    const rules = await client.fetch(path);
    if (fr.jsonOutput) {
      client.stdout.write(`${JSON.stringify({ rules }, null, 2)}
`);
    } else if (rules.length === 0) {
      output_manager_default.log("No alert rules found for this scope.");
    } else {
      for (const r of rules) {
        const id = typeof r.id === "string" ? r.id : "";
        const name = typeof r.name === "string" ? r.name : "";
        const pid = typeof r.projectId === "string" ? r.projectId : "";
        output_manager_default.log(
          `${id}	${name}${pid ? `	project: ${pid}` : "	(team-wide)"}`
        );
      }
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
  ls as default
};
