import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  STANDARD_ENVIRONMENTS
} from "./chunk-U7MQBM3F.js";
import {
  getCommandName,
  require_lib
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

// src/util/target/format-environment.ts
var import_chalk = __toESM(require_source(), 1);
var import_title = __toESM(require_lib(), 1);
function formatEnvironment(orgSlug, projectSlug, environment) {
  const projectUrl = `https://vercel.com/${orgSlug}/${projectSlug}`;
  const boldName = import_chalk.default.bold(
    STANDARD_ENVIRONMENTS.includes(environment.slug) ? (0, import_title.default)(environment.slug) : environment.slug
  );
  return output_manager_default.link(
    boldName,
    `${projectUrl}/settings/environments/${environment.slug}`,
    { fallback: () => boldName, color: false }
  );
}

// src/util/validate-ls-args.ts
var import_chalk2 = __toESM(require_source(), 1);
function validateLsArgs(options) {
  const { commandName, args, maxArgs = 0, exitCode = 1, usageString } = options;
  if (args.length > maxArgs) {
    const usage = usageString || getCommandName(commandName);
    output_manager_default.error(`Invalid number of arguments. Usage: ${import_chalk2.default.cyan(usage)}`);
    return exitCode;
  }
  return 0;
}

export {
  formatEnvironment,
  validateLsArgs
};
