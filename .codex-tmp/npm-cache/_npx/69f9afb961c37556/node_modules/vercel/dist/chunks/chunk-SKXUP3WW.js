import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  require_lib
} from "./chunk-U7MQBM3F.js";
import {
  packageName
} from "./chunk-ECRBC4HL.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/get-update-command.ts
var import_fs_extra = __toESM(require_lib(), 1);
import { sep, dirname, join, resolve } from "path";
import { scanParentDirs } from "@vercel/build-utils";
async function getConfigPrefix() {
  const paths = [
    process.env.npm_config_userconfig || process.env.NPM_CONFIG_USERCONFIG,
    join(process.env.HOME || "/", ".npmrc"),
    process.env.npm_config_globalconfig || process.env.NPM_CONFIG_GLOBALCONFIG
  ].filter(Boolean);
  for (const configPath of paths) {
    if (!configPath) {
      continue;
    }
    const content = await (0, import_fs_extra.readFile)(configPath).then((buffer) => buffer.toString()).catch(() => null);
    if (content) {
      const [prefix] = content.split("\n").map((line) => line && line.trim()).filter((line) => line && line.startsWith("prefix")).map((line) => line.slice(line.indexOf("=") + 1).trim());
      if (prefix) {
        return prefix;
      }
    }
  }
  return null;
}
async function isGlobal() {
  try {
    if (dirname(process.argv[0]) === dirname(process.argv[1])) {
      return true;
    }
    const isWindows = process.platform === "win32";
    const defaultPath = isWindows ? process.env.APPDATA : "/usr/local/lib";
    const installPath = await (0, import_fs_extra.realpath)(resolve(__dirname));
    if (installPath.includes(["", "yarn", "global", "node_modules", ""].join(sep))) {
      return true;
    }
    if (installPath.includes(["", "pnpm", "global", ""].join(sep))) {
      return true;
    }
    if (installPath.includes(["", "fnm", "node-versions", ""].join(sep))) {
      return true;
    }
    const prefixPath = process.env.PREFIX || process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX || await getConfigPrefix() || defaultPath;
    if (!prefixPath) {
      return true;
    }
    return installPath.startsWith(await (0, import_fs_extra.realpath)(prefixPath));
  } catch (_) {
    return true;
  }
}
async function getUpdateCommand() {
  const pkgAndVersion = `${packageName}@latest`;
  const entrypoint = await (0, import_fs_extra.realpath)(process.argv[1]);
  let { cliType, lockfilePath } = await scanParentDirs(
    dirname(dirname(entrypoint))
  );
  if (!lockfilePath) {
    cliType = "npm";
  }
  const yarn = cliType === "yarn";
  let install = yarn ? "add" : "i";
  if (await isGlobal()) {
    if (yarn) {
      install = "global add";
    } else {
      install = "i -g";
    }
  }
  return `${cliType} ${install} ${pkgAndVersion}`;
}

export {
  isGlobal,
  getUpdateCommand
};
