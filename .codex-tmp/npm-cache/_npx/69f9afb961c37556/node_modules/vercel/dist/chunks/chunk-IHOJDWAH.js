import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  writeProjectSettings
} from "./chunk-6WHQFFN2.js";
import {
  ensureLink
} from "./chunk-5VQMJCHT.js";
import {
  autoInstallVercelPlugin,
  pullCommand
} from "./chunk-UBOSX7RM.js";
import {
  help
} from "./chunk-LDXYSGPZ.js";
import {
  VERCEL_DIR,
  VERCEL_DIR_PROJECT,
  envPullCommandLogic,
  humanizePath,
  parseTarget
} from "./chunk-U7MQBM3F.js";
import {
  TelemetryClient
} from "./chunk-U3WLEFHU.js";
import {
  stamp_default
} from "./chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  emoji,
  output_manager_default,
  prependEmoji
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/commands/pull/index.ts
var import_chalk = __toESM(require_source(), 1);
import { join } from "path";

// src/util/telemetry/commands/pull/index.ts
var PullTelemetryClient = class extends TelemetryClient {
  trackCliArgumentProjectPath(value) {
    if (value) {
      this.trackCliArgument({
        arg: "projectPath",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionEnvironment(environment) {
    if (environment) {
      this.trackCliOption({
        option: "environment",
        value: this.redactedTargetName(environment)
      });
    }
  }
  trackCliOptionGitBranch(gitBranch) {
    if (gitBranch) {
      this.trackCliOption({
        option: "git-branch",
        value: this.redactedValue
      });
    }
  }
  trackCliFlagProd(isProduction) {
    if (isProduction) {
      this.trackCliFlag("prod");
    }
  }
  trackCliFlagYes(yes) {
    if (yes) {
      this.trackCliFlag("yes");
    }
  }
};

// src/commands/pull/index.ts
async function pullAllEnvFiles(environment, client, link, flags, cwd) {
  const environmentFile = `.env.${environment}.local`;
  await envPullCommandLogic(
    client,
    join(".vercel", environmentFile),
    !!flags["--yes"],
    environment,
    link,
    flags["--git-branch"],
    cwd,
    "vercel-cli:pull"
  );
  return 0;
}
async function main(client) {
  let parsedArgs = null;
  const flagsSpecification = getFlagsSpecification(pullCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (error) {
    printError(error);
    return 1;
  }
  const telemetryClient = new PullTelemetryClient({
    opts: {
      store: client.telemetryEventStore
    }
  });
  if (parsedArgs.flags["--help"]) {
    telemetryClient.trackCliFlagHelp("pull");
    output_manager_default.print(help(pullCommand, { columns: client.stderr.columns }));
    return 2;
  }
  const cwd = parsedArgs.args[1] || client.cwd;
  const autoConfirm = Boolean(parsedArgs.flags["--yes"]);
  const isProduction = Boolean(parsedArgs.flags["--prod"]);
  const environment = parseTarget({
    flagName: "environment",
    flags: parsedArgs.flags
  }) || "development";
  telemetryClient.trackCliArgumentProjectPath(parsedArgs.args[1]);
  telemetryClient.trackCliFlagYes(autoConfirm);
  telemetryClient.trackCliFlagProd(isProduction);
  telemetryClient.trackCliOptionGitBranch(parsedArgs.flags["--git-branch"]);
  telemetryClient.trackCliOptionEnvironment(parsedArgs.flags["--environment"]);
  const returnCode = await pullCommandLogic(
    client,
    cwd,
    autoConfirm,
    environment,
    parsedArgs.flags
  );
  if (returnCode === 0 && !autoConfirm) {
    await autoInstallVercelPlugin(client);
  }
  return returnCode;
}
async function pullCommandLogic(client, cwd, autoConfirm, environment, flags) {
  const link = await ensureLink("pull", client, cwd, {
    autoConfirm,
    pullEnv: false
  });
  if (typeof link === "number") {
    return link;
  }
  const { project, org, repoRoot } = link;
  let currentDirectory;
  if (repoRoot) {
    currentDirectory = join(repoRoot, project.rootDirectory || "");
  } else {
    currentDirectory = cwd;
  }
  client.config.currentTeam = org.type === "team" ? org.id : void 0;
  const pullResultCode = await pullAllEnvFiles(
    environment,
    client,
    link,
    flags,
    currentDirectory
  );
  if (pullResultCode !== 0) {
    return pullResultCode;
  }
  output_manager_default.print("\n");
  output_manager_default.log("Downloading project settings");
  const isRepoLinked = typeof repoRoot === "string";
  await writeProjectSettings(currentDirectory, project, org, isRepoLinked);
  const settingsStamp = stamp_default();
  output_manager_default.print(
    `${prependEmoji(
      `Downloaded project settings to ${import_chalk.default.bold(
        humanizePath(join(currentDirectory, VERCEL_DIR, VERCEL_DIR_PROJECT))
      )} ${import_chalk.default.gray(settingsStamp())}`,
      emoji("success")
    )}
`
  );
  return 0;
}

export {
  main,
  pullCommandLogic
};
