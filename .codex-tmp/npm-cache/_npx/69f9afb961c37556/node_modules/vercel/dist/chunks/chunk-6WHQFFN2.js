import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  VERCEL_DIR,
  VERCEL_DIR_PROJECT,
  require_lib
} from "./chunk-U7MQBM3F.js";
import {
  require_dist
} from "./chunk-ZQKJVHXY.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/projects/project-settings.ts
var import_fs_extra = __toESM(require_lib(), 1);
import { join } from "path";
var import_error_utils = __toESM(require_dist(), 1);
async function writeProjectSettings(cwd, project, org, isRepoLinked) {
  let analyticsId;
  if (project.analytics?.id && (!project.analytics.disabledAt || project.analytics.enabledAt && project.analytics.enabledAt > project.analytics.disabledAt)) {
    analyticsId = project.analytics.id;
  }
  const projectLinkAndSettings = {
    projectId: isRepoLinked ? void 0 : project.id,
    orgId: isRepoLinked ? void 0 : org.id,
    projectName: isRepoLinked ? void 0 : project.name,
    settings: {
      createdAt: project.createdAt,
      framework: project.framework,
      devCommand: project.devCommand,
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      outputDirectory: project.outputDirectory,
      rootDirectory: project.rootDirectory,
      directoryListing: project.directoryListing,
      nodeVersion: project.nodeVersion,
      analyticsId
    }
  };
  const path = join(cwd, VERCEL_DIR, VERCEL_DIR_PROJECT);
  return await (0, import_fs_extra.outputJSON)(path, projectLinkAndSettings, {
    spaces: 2
  });
}
async function readProjectSettings(vercelDir) {
  try {
    return JSON.parse(
      await (0, import_fs_extra.readFile)(join(vercelDir, VERCEL_DIR_PROJECT), "utf8")
    );
  } catch (err) {
    if ((0, import_error_utils.isErrnoException)(err) && err.code && ["ENOENT", "ENOTDIR"].includes(err.code)) {
      return null;
    }
    if ((0, import_error_utils.isError)(err) && err.name === "SyntaxError") {
      return null;
    }
    throw err;
  }
}
function pickOverrides(vercelConfig) {
  const overrides = {};
  for (const prop of [
    "buildCommand",
    "devCommand",
    "framework",
    "ignoreCommand",
    "installCommand",
    "outputDirectory"
  ]) {
    if (typeof vercelConfig[prop] !== "undefined") {
      if (prop === "ignoreCommand") {
        overrides.commandForIgnoringBuildStep = vercelConfig[prop];
      } else {
        overrides[prop] = vercelConfig[prop];
      }
    }
  }
  return overrides;
}

export {
  writeProjectSettings,
  readProjectSettings,
  pickOverrides
};
