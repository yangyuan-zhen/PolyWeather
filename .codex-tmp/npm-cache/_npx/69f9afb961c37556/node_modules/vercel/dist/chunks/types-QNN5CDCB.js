import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  validateJsonOutput
} from "./chunk-XPKWKPWA.js";
import {
  typesSubcommand
} from "./chunk-UWKTUK3W.js";
import {
  table
} from "./chunk-GE6G37P4.js";
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
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/commands/activity/types.ts
var import_chalk = __toESM(require_source(), 1);
function formatErrorJson(code, message) {
  return `${JSON.stringify({ error: { code, message } }, null, 2)}
`;
}
async function types(client, telemetry) {
  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(typesSubcommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }
  const flags = parsedArgs.flags;
  telemetry.trackCliOptionFormat(flags["--format"]);
  const formatResult = validateJsonOutput(flags);
  if (!formatResult.valid) {
    output_manager_default.error(formatResult.error);
    return 1;
  }
  const jsonOutput = formatResult.jsonOutput;
  output_manager_default.spinner("Fetching event types...");
  try {
    const response = await client.fetch("/v1/events/types");
    const eventTypes = response.types ?? [];
    if (jsonOutput) {
      client.stdout.write(`${JSON.stringify(response, null, 2)}
`);
      return 0;
    }
    if (eventTypes.length === 0) {
      output_manager_default.log("No activity event types found.");
      return 0;
    }
    const rows = [
      [import_chalk.default.bold(import_chalk.default.cyan("Name")), import_chalk.default.bold(import_chalk.default.cyan("Description"))],
      ...eventTypes.map((eventType) => [
        eventType.name,
        eventType.deprecated ? `${eventType.description ?? "-"} (Deprecated)` : eventType.description ?? "-"
      ])
    ];
    const tableOutput = table(rows, { hsep: 4 }).split("\n").map((line) => line.trimEnd()).join("\n").replace(/^/gm, "  ");
    output_manager_default.print(`
${tableOutput}

`);
    return 0;
  } catch (err) {
    if (isAPIError(err)) {
      if (err.status === 403) {
        const message2 = "You do not have permission to list activity event types.";
        if (jsonOutput) {
          client.stdout.write(formatErrorJson("FORBIDDEN", message2));
        } else {
          output_manager_default.error(message2);
        }
        return 1;
      }
      const message = err.serverMessage || `API error (${err.status}).`;
      if (jsonOutput) {
        client.stdout.write(formatErrorJson(err.code || "API_ERROR", message));
      } else {
        output_manager_default.error(message);
      }
      return 1;
    }
    throw err;
  } finally {
    output_manager_default.stopSpinner();
  }
}
export {
  types as default
};
