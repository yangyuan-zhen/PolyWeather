import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/get-command-flags.ts
function getCommandFlags(argv, excludeFlags = []) {
  const flags = Object.keys(argv).filter((key) => !excludeFlags.includes(key)).map(
    (key) => `${key}${typeof argv[key] !== "boolean" ? " " + argv[key] : ""}`
  );
  return flags.length > 0 ? ` ${flags.join(" ")}` : "";
}

export {
  getCommandFlags
};
