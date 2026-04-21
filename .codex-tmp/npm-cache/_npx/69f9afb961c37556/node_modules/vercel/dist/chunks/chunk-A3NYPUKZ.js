import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/output/indent.ts
var indent_default = (input, level) => {
  const fill = " ".repeat(level);
  return `${fill}${input.replace(/\n/g, `
${fill}`)}`;
};

export {
  indent_default
};
