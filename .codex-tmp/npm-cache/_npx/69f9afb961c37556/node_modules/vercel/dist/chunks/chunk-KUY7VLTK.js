import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  VERCEL_DIR,
  isVercelTomlEnabled
} from "./chunk-U7MQBM3F.js";
import {
  getArgs
} from "./chunk-RFMC2QXQ.js";
import {
  ConflictingConfigFiles,
  InvalidLocalConfig
} from "./chunk-ECRBC4HL.js";

// src/util/config/local-path.ts
import path from "path";
import { existsSync } from "fs";
function getLocalPathConfig(prefix) {
  const argv = getArgs(process.argv.slice(2), {}, { permissive: true });
  const customPath = argv["--local-config"];
  if (customPath) {
    if (typeof customPath !== "string") {
      throw new InvalidLocalConfig(customPath);
    }
    return path.resolve(prefix, customPath);
  }
  const vercelConfigPath = path.join(prefix, "vercel.json");
  const vercelTomlPath = path.join(prefix, "vercel.toml");
  const nowConfigPath = path.join(prefix, "now.json");
  const vercelConfigExists = existsSync(vercelConfigPath);
  const vercelTomlExists = isVercelTomlEnabled() && existsSync(vercelTomlPath);
  const nowConfigExists = existsSync(nowConfigPath);
  const foundConfigs = [];
  if (vercelConfigExists)
    foundConfigs.push(vercelConfigPath);
  if (vercelTomlExists)
    foundConfigs.push(vercelTomlPath);
  if (nowConfigExists)
    foundConfigs.push(nowConfigPath);
  if (foundConfigs.length > 1) {
    throw new ConflictingConfigFiles(foundConfigs);
  }
  const compiledConfigPath = path.join(prefix, VERCEL_DIR, "vercel.json");
  const compiledConfigExists = existsSync(compiledConfigPath);
  if (compiledConfigExists) {
    return compiledConfigPath;
  }
  if (nowConfigExists) {
    return nowConfigPath;
  }
  return vercelConfigPath;
}

export {
  getLocalPathConfig
};
