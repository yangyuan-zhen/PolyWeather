import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/parse-meta.ts
function parseMeta(meta) {
  if (!meta) {
    return {};
  }
  if (typeof meta === "string") {
    meta = [meta];
  }
  const parsed = {};
  for (const item of meta) {
    const [key, ...rest] = item.split("=");
    parsed[key] = rest.join("=");
  }
  return parsed;
}

export {
  parseMeta
};
