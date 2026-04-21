import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  table
} from "./chunk-GE6G37P4.js";
import {
  require_strip_ansi
} from "./chunk-RFMC2QXQ.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/format-table.ts
var import_chalk = __toESM(require_source(), 1);

// src/util/strlen.ts
var import_strip_ansi = __toESM(require_strip_ansi(), 1);
function strlen(str) {
  return (0, import_strip_ansi.default)(str).length;
}

// src/util/format-table.ts
function formatTable(header, align, blocks) {
  const nrCols = header.length;
  const padding = [];
  let out = "\n";
  for (let i = 0; i < nrCols; i++) {
    padding[i] = blocks.reduce((acc, block) => {
      const maxLen = Math.max(...block.rows.map((row) => strlen(`${row[i]}`)));
      return Math.max(acc, Math.ceil(maxLen / 8));
    }, 1);
  }
  for (const block of blocks) {
    if (block.name) {
      out += `${block.name}
`;
    }
    const rows = [header.map((s) => import_chalk.default.dim(s))].concat(block.rows);
    if (rows.length > 0) {
      rows[0][0] = ` ${rows[0][0]}`;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i].slice(0);
        row[0] = ` ${row[0]}`;
        for (let j = 0; j < nrCols; j++) {
          const col = `${row[j]}`;
          const al = align[j] || "l";
          const repeat = padding[j] > 1 ? padding[j] * 8 - strlen(col) : 0;
          const pad = repeat > 0 ? " ".repeat(repeat) : "";
          rows[i][j] = al === "l" ? col + pad : pad + col;
        }
      }
      out += table(rows, { align, hsep: 4 });
    }
    out += "\n\n";
  }
  return out.slice(0, -1);
}

export {
  formatTable
};
