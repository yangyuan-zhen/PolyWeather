import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/suggest-next-commands.ts
var import_chalk = __toESM(require_source(), 1);
function suggestNextCommands(commands) {
  output_manager_default.print(
    import_chalk.default.dim(
      [
        `Common next commands:`,
        ...commands.map((command) => `- ${command}`)
      ].join("\n")
    )
  );
  output_manager_default.print("\n");
}

export {
  suggestNextCommands
};
