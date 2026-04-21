import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/get-subcommand.ts
function getSubcommand(cliArgs, config) {
  const [subcommand, ...rest] = cliArgs;
  for (const k of Object.keys(config)) {
    if (k !== "default" && config[k].indexOf(subcommand) !== -1) {
      return {
        subcommand: k,
        subcommandOriginal: subcommand,
        args: rest
      };
    }
  }
  return {
    subcommand: config.default,
    subcommandOriginal: "default",
    args: cliArgs
  };
}

export {
  getSubcommand
};
