import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  init_pkg,
  pkg_default
} from "./chunk-ECRBC4HL.js";

// src/util/ua.ts
init_pkg();
import os from "os";
var ua_default = `${pkg_default.name} ${pkg_default.version} node-${process.version} ${os.platform()} (${os.arch()})`;

export {
  ua_default
};
