import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  OUTPUT_DIR,
  importBuilders,
  isLambda,
  staticFiles,
  writeBuildResult
} from "../../chunks/chunk-N5IS4YW4.js";
import {
  require_semver
} from "../../chunks/chunk-IB5L4LKZ.js";
import {
  pullCommandLogic
} from "../../chunks/chunk-IHOJDWAH.js";
import {
  pickOverrides,
  readProjectSettings
} from "../../chunks/chunk-6WHQFFN2.js";
import {
  ua_default
} from "../../chunks/chunk-4PQA6H63.js";
import "../../chunks/chunk-AQ4L3FS4.js";
import "../../chunks/chunk-5VQMJCHT.js";
import "../../chunks/chunk-H2PHTCJL.js";
import "../../chunks/chunk-KUY7VLTK.js";
import {
  buildCommand
} from "../../chunks/chunk-UBOSX7RM.js";
import {
  AGENT_REASON,
  AGENT_STATUS
} from "../../chunks/chunk-E3NE4SKN.js";
import {
  help
} from "../../chunks/chunk-LDXYSGPZ.js";
import "../../chunks/chunk-GE6G37P4.js";
import {
  DEFAULT_VERCEL_CONFIG_FILENAME,
  VERCEL_DIR,
  compileVercelConfig,
  findSourceVercelConfigFile,
  getProjectLink,
  parseTarget,
  pullEnvRecords,
  readJSONFile,
  require_ajv,
  require_dist,
  require_dist2,
  require_dist3,
  require_frameworks,
  require_lib,
  require_main,
  require_minimatch,
  resolveProjectCwd,
  validateConfig
} from "../../chunks/chunk-U7MQBM3F.js";
import {
  TelemetryClient
} from "../../chunks/chunk-U3WLEFHU.js";
import {
  outputAgentError
} from "../../chunks/chunk-XKHLPA6V.js";
import {
  stamp_default
} from "../../chunks/chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  getGlobalFlagsOnlyFromArgs,
  parseArguments,
  printError,
  toEnumerableError
} from "../../chunks/chunk-RFMC2QXQ.js";
import {
  CantParseJSONFile,
  cmd,
  getCommandName,
  getCommandNamePlain,
  init_pkg,
  packageName,
  pkg_default,
  require_lib as require_lib2
} from "../../chunks/chunk-ECRBC4HL.js";
import {
  emoji,
  output_manager_default,
  prependEmoji
} from "../../chunks/chunk-ZQKJVHXY.js";
import {
  require_source
} from "../../chunks/chunk-S7KYDPEM.js";
import {
  __toESM
} from "../../chunks/chunk-TZ2YI2VH.js";

// src/commands/build/index.ts
var import_chalk = __toESM(require_source(), 1);
var import_dotenv = __toESM(require_main(), 1);
var import_fs_extra2 = __toESM(require_lib(), 1);
var import_minimatch = __toESM(require_minimatch(), 1);
var import_semver = __toESM(require_semver(), 1);
var import_client = __toESM(require_dist(), 1);
var import_frameworks2 = __toESM(require_frameworks(), 1);
var import_fs_detectors2 = __toESM(require_dist3(), 1);
var import_routing_utils2 = __toESM(require_dist2(), 1);
import { dirname, join as join2, normalize, relative as relative2, resolve, sep } from "path";
import { readdirSync, statSync } from "fs";
import {
  download,
  FileBlob,
  FileFsRef,
  getDiscontinuedNodeVersions,
  getInstalledPackageVersion,
  getServiceUrlEnvVars,
  normalizePath,
  NowBuildError as NowBuildError2,
  runNpmInstall,
  runCustomInstallCommand,
  resetCustomInstallCommandSet,
  Span,
  validateNpmrc,
  glob,
  getInternalServiceCronPath,
  getInternalServiceFunctionPath,
  getServiceQueueTopicConfigs,
  isBackendBuilder,
  isQueueTriggeredService,
  isScheduleTriggeredService,
  sanitizeConsumerName,
  downloadFile
} from "@vercel/build-utils";

// src/util/build/corepack.ts
var import_fs_extra = __toESM(require_lib(), 1);
import { delimiter, join } from "path";
import { spawnAsync } from "@vercel/build-utils";
async function initCorepack({
  repoRootPath
}) {
  if (process.env.ENABLE_EXPERIMENTAL_COREPACK !== "1") {
    return null;
  }
  const pkg = await readJSONFile(
    join(repoRootPath, "package.json")
  );
  if (pkg instanceof CantParseJSONFile) {
    output_manager_default.warn(
      "Warning: Could not enable corepack because package.json is invalid JSON",
      pkg.meta.parseErrorLocation
    );
  } else if (!pkg?.packageManager) {
    output_manager_default.warn(
      'Warning: Could not enable corepack because package.json is missing "packageManager" property'
    );
  } else {
    output_manager_default.log(
      `Detected ENABLE_EXPERIMENTAL_COREPACK=1 and "${pkg.packageManager}" in package.json`
    );
    const corepackRootDir = join(repoRootPath, VERCEL_DIR, "cache", "corepack");
    const corepackHomeDir = join(corepackRootDir, "home");
    const corepackShimDir = join(corepackRootDir, "shim");
    await import_fs_extra.default.mkdirp(corepackHomeDir);
    await import_fs_extra.default.mkdirp(corepackShimDir);
    process.env.COREPACK_HOME = corepackHomeDir;
    process.env.PATH = `${corepackShimDir}${delimiter}${process.env.PATH}`;
    const pkgManagerName = pkg.packageManager.split("@")[0];
    await spawnAsync(
      "corepack",
      ["enable", pkgManagerName, "--install-directory", corepackShimDir],
      {
        prettyCommand: `corepack enable ${pkgManagerName}`
      }
    );
    return corepackShimDir;
  }
  return null;
}
function cleanupCorepack(corepackShimDir) {
  if (process.env.COREPACK_HOME) {
    delete process.env.COREPACK_HOME;
  }
  if (process.env.PATH) {
    process.env.PATH = process.env.PATH.replace(
      `${corepackShimDir}${delimiter}`,
      ""
    );
  }
}

// src/util/build/monorepo.ts
var import_fs_detectors = __toESM(require_dist3(), 1);
var import_title = __toESM(require_lib2(), 1);
import { relative, basename } from "path";
import { debug } from "@vercel/build-utils";
async function setMonorepoDefaultSettings(cwd, workPath, projectSettings) {
  const localFileSystem = new import_fs_detectors.LocalFileSystemDetector(cwd);
  const projectName = basename(workPath);
  const relativeToRoot = relative(workPath, cwd);
  const setCommand = (command, value) => {
    if (projectSettings[command]) {
      debug(
        `Skipping auto-assignment of ${command} as it is already set via project settings or configuration overrides.`
      );
    } else {
      projectSettings[command] = value;
    }
  };
  try {
    const result = await (0, import_fs_detectors.getMonorepoDefaultSettings)(
      projectName,
      relative(cwd, workPath),
      relativeToRoot,
      localFileSystem
    );
    if (result === null) {
      return;
    }
    projectSettings.monorepoManager = result.monorepoManager;
    const { monorepoManager, ...commands } = result;
    output_manager_default.log(
      `Detected ${(0, import_title.default)(monorepoManager)}. Adjusting default settings...`
    );
    if (commands.buildCommand) {
      setCommand("buildCommand", commands.buildCommand);
    }
    if (commands.installCommand) {
      setCommand("installCommand", commands.installCommand);
    }
    if (commands.commandForIgnoringBuildStep) {
      setCommand(
        "commandForIgnoringBuildStep",
        commands.commandForIgnoringBuildStep
      );
    }
  } catch (error) {
    if (error instanceof import_fs_detectors.MissingBuildPipeline || error instanceof import_fs_detectors.MissingBuildTarget) {
      output_manager_default.warn(`${error.message} Skipping automatic setting assignment.`);
      return;
    }
    throw error;
  }
}

// src/util/build/scrub-argv.ts
function scrubArgv(argv) {
  const clonedArgv = [...argv];
  const tokenRE = /^(-[A-Za-z]*[bet]|--(?:build-env|env|token))(=.*)?$/;
  for (let i = 0, len = clonedArgv.length; i < len; i++) {
    const m = clonedArgv[i].match(tokenRE);
    if (m?.[2]) {
      clonedArgv[i] = `${m[1]}=REDACTED`;
    } else if (m && i + 1 < len) {
      clonedArgv[++i] = "REDACTED";
    }
  }
  return clonedArgv;
}

// src/util/build/service-route-ownership.ts
var import_routing_utils = __toESM(require_dist2(), 1);
function isWebServiceWithPrefix(service) {
  return service.type === "web" && typeof service.routePrefix === "string";
}
function getWebRoutePrefixes(services) {
  const unique = /* @__PURE__ */ new Set();
  for (const service of services) {
    if (!isWebServiceWithPrefix(service))
      continue;
    unique.add((0, import_routing_utils.normalizeRoutePrefix)(service.routePrefix));
  }
  return Array.from(unique);
}
function scopeRoutesToServiceOwnership({
  routes,
  owner,
  allServices
}) {
  if (!isWebServiceWithPrefix(owner)) {
    return routes;
  }
  const allWebPrefixes = getWebRoutePrefixes(allServices);
  const ownershipGuard = (0, import_routing_utils.getOwnershipGuard)(owner.routePrefix, allWebPrefixes);
  if (!ownershipGuard) {
    return routes;
  }
  return routes.map((route) => {
    if ("handle" in route || typeof route.src !== "string") {
      return route;
    }
    return {
      ...route,
      src: (0, import_routing_utils.scopeRouteSourceToOwnership)(route.src, ownershipGuard)
    };
  });
}

// src/util/build/sort-builders.ts
var import_frameworks = __toESM(require_frameworks(), 1);
function sortBuilders(builds) {
  const frontendRuntimeSet = new Set(
    import_frameworks.frameworkList.map((f) => f.useRuntime?.use || "@vercel/static-build")
  );
  frontendRuntimeSet.delete("@vercel/python");
  frontendRuntimeSet.delete("@vercel/ruby");
  frontendRuntimeSet.delete("@vercel/rust");
  const toNumber = (build) => build.use === "@vercel/python" || build.use === "@vercel/ruby" || build.use === "@vercel/rust" ? 1 : frontendRuntimeSet.has(build.use) ? 0 : 2;
  return builds.sort((build1, build2) => {
    return toNumber(build1) - toNumber(build2);
  });
}

// src/commands/build/index.ts
init_pkg();

// src/util/telemetry/commands/build/index.ts
var BuildTelemetryClient = class extends TelemetryClient {
  trackCliOptionOutput(path) {
    if (path) {
      this.trackCliOption({
        option: "output",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionTarget(option) {
    if (option) {
      this.trackCliOption({
        option: "target",
        value: this.redactedTargetName(option)
      });
    }
  }
  trackCliFlagProd(flag) {
    if (flag) {
      this.trackCliFlag("prod");
    }
  }
  trackCliFlagYes(flag) {
    if (flag) {
      this.trackCliFlag("yes");
    }
  }
  trackCliFlagStandalone(flag) {
    if (flag) {
      this.trackCliFlag("standalone");
    }
  }
  trackCliOptionId(id) {
    if (id) {
      this.trackCliOption({
        option: "id",
        value: this.redactedValue
      });
    }
  }
};

// src/util/validate-cron-secret.ts
import { NowBuildError } from "@vercel/build-utils";
function validateCronSecret(cronSecret) {
  if (!cronSecret) {
    return null;
  }
  if (cronSecret !== cronSecret.trim()) {
    return new NowBuildError({
      code: "INVALID_CRON_SECRET",
      message: "The `CRON_SECRET` environment variable contains leading or trailing whitespace, which is not allowed in HTTP header values.",
      link: "https://vercel.link/securing-cron-jobs",
      action: "Learn More"
    });
  }
  const invalidChars = [];
  for (let i = 0; i < cronSecret.length; i++) {
    const code = cronSecret.charCodeAt(i);
    const isValidChar = code === 9 || // HTAB
    code >= 32 && code <= 126;
    if (!isValidChar) {
      invalidChars.push({
        char: cronSecret[i],
        index: i,
        code
      });
    }
  }
  if (invalidChars.length > 0) {
    const descriptions = invalidChars.slice(0, 3).map(({ code, index }) => {
      if (code < 32) {
        return `control character (0x${code.toString(16).padStart(2, "0")}) at position ${index}`;
      } else if (code === 127) {
        return `DEL character at position ${index}`;
      } else {
        return `non-ASCII character (0x${code.toString(16).padStart(2, "0")}) at position ${index}`;
      }
    });
    const moreCount = invalidChars.length - 3;
    const moreText = moreCount > 0 ? `, and ${moreCount} more` : "";
    return new NowBuildError({
      code: "INVALID_CRON_SECRET",
      message: `The \`CRON_SECRET\` environment variable contains characters that are not valid in HTTP headers: ${descriptions.join(", ")}${moreText}. Only visible ASCII characters (letters, digits, symbols), spaces, and tabs are allowed.`,
      link: "https://vercel.link/securing-cron-jobs",
      action: "Learn More"
    });
  }
  return null;
}

// src/util/validate-package-manifest.ts
var import_ajv = __toESM(require_ajv(), 1);
import { packageManifestSchema } from "@vercel/build-utils";
var ajv = new import_ajv.default();
var validate = ajv.compile(packageManifestSchema);
function validatePackageManifest(data) {
  if (validate(data)) {
    return null;
  }
  const errors = validate.errors ?? [];
  return errors.map((e) => `${e.dataPath || "(root)"} ${e.message}`).join("; ");
}

// src/commands/build/index.ts
function buildCommandWithGlobalFlags(baseSubcommand, argv) {
  const globalFlags = getGlobalFlagsOnlyFromArgs(argv.slice(2));
  const full = globalFlags.length ? `${baseSubcommand} ${globalFlags.join(" ")}` : baseSubcommand;
  return getCommandNamePlain(full);
}
async function main(client) {
  const telemetryClient = new BuildTelemetryClient({
    opts: {
      store: client.telemetryEventStore
    }
  });
  const rootSpan = client.rootSpan?.child("vc") ?? new Span({ name: "vc" });
  let { cwd } = client;
  cwd = await resolveProjectCwd(cwd);
  if (process.env.__VERCEL_BUILD_RUNNING) {
    output_manager_default.error(
      `${cmd(
        `${packageName} build`
      )} must not recursively invoke itself. Check the Build Command in the Project Settings or the ${cmd(
        "build"
      )} script in ${cmd("package.json")}`
    );
    output_manager_default.error(
      `Learn More: https://vercel.link/recursive-invocation-of-commands`
    );
    return 1;
  } else {
    process.env.__VERCEL_BUILD_RUNNING = "1";
  }
  let parsedArgs = null;
  const flagsSpecification = getFlagsSpecification(buildCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
    telemetryClient.trackCliOptionOutput(parsedArgs.flags["--output"]);
    telemetryClient.trackCliOptionTarget(parsedArgs.flags["--target"]);
    telemetryClient.trackCliFlagProd(parsedArgs.flags["--prod"]);
    telemetryClient.trackCliFlagYes(parsedArgs.flags["--yes"]);
    telemetryClient.trackCliFlagStandalone(parsedArgs.flags["--standalone"]);
    telemetryClient.trackCliOptionId(parsedArgs.flags["--id"]);
  } catch (error) {
    printError(error);
    return 1;
  }
  if (parsedArgs.flags["--help"]) {
    telemetryClient.trackCliFlagHelp("build");
    output_manager_default.print(help(buildCommand, { columns: client.stderr.columns }));
    return 2;
  }
  const target = parseTarget({
    flagName: "target",
    flags: parsedArgs.flags
  }) || "preview";
  const yes = Boolean(parsedArgs.flags["--yes"]);
  const hasDeprecatedEnvVar = process.env.VERCEL_EXPERIMENTAL_STANDALONE_BUILD === "1";
  if (hasDeprecatedEnvVar) {
    output_manager_default.warn(
      "The VERCEL_EXPERIMENTAL_STANDALONE_BUILD environment variable is deprecated. Please use the --standalone flag instead."
    );
  }
  const standalone = Boolean(
    parsedArgs.flags["--standalone"] || hasDeprecatedEnvVar
  );
  try {
    await validateNpmrc(cwd);
  } catch (err) {
    output_manager_default.prettyError(err);
    return 1;
  }
  const link = await rootSpan.child("vc.getProjectLink").trace(() => getProjectLink(client, cwd));
  const projectRootDirectory = link?.projectRootDirectory ?? "";
  if (link?.repoRoot) {
    cwd = client.cwd = link.repoRoot;
  }
  const vercelDir = join2(cwd, projectRootDirectory, VERCEL_DIR);
  let project = await rootSpan.child("vc.readProjectSettings").trace(() => readProjectSettings(vercelDir));
  const isTTY = process.stdin.isTTY;
  while (!project?.settings) {
    let confirmed = yes;
    if (!confirmed) {
      if (client.nonInteractive) {
        outputAgentError(
          client,
          {
            status: AGENT_STATUS.ERROR,
            reason: AGENT_REASON.PROJECT_SETTINGS_REQUIRED,
            message: "No project settings found locally. Run pull to retrieve them, or re-run with --yes to pull automatically.",
            next: [
              {
                command: buildCommandWithGlobalFlags(
                  `pull --yes --environment ${target}`,
                  client.argv
                ),
                when: "retrieve project settings"
              },
              {
                command: buildCommandWithGlobalFlags(
                  "build --yes",
                  client.argv
                ),
                when: "re-run build after pull"
              }
            ]
          },
          1
        );
        return 1;
      }
      if (!isTTY) {
        output_manager_default.print(
          `No Project Settings found locally. Run ${getCommandName(
            "pull --yes"
          )} to retrieve them. In non-interactive mode, set VERCEL_TOKEN for authentication.`
        );
        return 1;
      }
      confirmed = await client.input.confirm(
        `No Project Settings found locally. Run ${getCommandName(
          "pull"
        )} for retrieving them?`,
        true
      );
    }
    if (!confirmed) {
      if (!client.nonInteractive)
        output_manager_default.print(`Canceled. No Project Settings retrieved.
`);
      return 0;
    }
    const { argv: originalArgv } = client;
    client.cwd = join2(cwd, projectRootDirectory);
    client.argv = [
      ...originalArgv.slice(0, 2),
      "pull",
      `--environment`,
      target
    ];
    const result = await pullCommandLogic(
      client,
      client.cwd,
      Boolean(parsedArgs.flags["--yes"]),
      target,
      parsedArgs.flags
    );
    if (result !== 0) {
      return result;
    }
    client.cwd = cwd;
    client.argv = originalArgv;
    project = await readProjectSettings(vercelDir);
  }
  const defaultOutputDir = join2(cwd, projectRootDirectory, OUTPUT_DIR);
  const outputDir = parsedArgs.flags["--output"] ? resolve(parsedArgs.flags["--output"]) : defaultOutputDir;
  client.traceDiagnosticsPath = join2(
    outputDir,
    "diagnostics",
    "cli_traces.json"
  );
  await Promise.all([
    import_fs_extra2.default.remove(outputDir),
    // Also delete `.vercel/output`, in case the script is targeting Build Output API directly
    outputDir !== defaultOutputDir ? import_fs_extra2.default.remove(defaultOutputDir) : void 0
  ]);
  const buildsJson = {
    "//": "This file was generated by the `vercel build` command. It is not part of the Build Output API.",
    target,
    argv: scrubArgv(process.argv),
    cliVersion: pkg_default.version
  };
  const deploymentId = parsedArgs.flags["--id"];
  if (!process.env.VERCEL_BUILD_IMAGE && !deploymentId && !client.nonInteractive) {
    output_manager_default.warn(
      "Build not running on Vercel. System environment variables will not be available."
    );
  }
  const envToUnset = /* @__PURE__ */ new Set(["VERCEL", "NOW_BUILDER"]);
  try {
    const loadEnvSpan = rootSpan.child("vc.loadEnv");
    try {
      if (deploymentId) {
        if (link?.orgId?.startsWith("team_")) {
          client.config.currentTeam = link.orgId;
        }
        output_manager_default.debug(
          `Fetching environment variables for deployment ${deploymentId}`
        );
        const { buildEnv } = await fetchDeploymentBuildEnv(
          client,
          deploymentId
        );
        for (const [key, value] of Object.entries(buildEnv)) {
          envToUnset.add(key);
          process.env[key] = value;
        }
        output_manager_default.debug(
          `Loaded ${Object.keys(buildEnv).length} environment variables from deployment ${deploymentId}`
        );
      } else {
        const envPath = join2(
          cwd,
          projectRootDirectory,
          VERCEL_DIR,
          `.env.${target}.local`
        );
        const dotenvResult = import_dotenv.default.config({
          path: envPath,
          debug: output_manager_default.isDebugEnabled()
        });
        if (dotenvResult.error) {
          output_manager_default.debug(
            `Failed loading environment variables: ${dotenvResult.error}`
          );
        } else if (dotenvResult.parsed) {
          for (const key of Object.keys(dotenvResult.parsed)) {
            envToUnset.add(key);
          }
          output_manager_default.debug(`Loaded environment variables from "${envPath}"`);
        }
      }
    } finally {
      loadEnvSpan.stop();
    }
    if (project.settings.analyticsId) {
      envToUnset.add("VERCEL_ANALYTICS_ID");
      process.env.VERCEL_ANALYTICS_ID = project.settings.analyticsId;
    }
    process.env.VERCEL = "1";
    process.env.NOW_BUILDER = "1";
    try {
      await rootSpan.child("vc.doBuild").trace(
        (span) => doBuild(client, project, buildsJson, cwd, outputDir, span, standalone)
      );
    } finally {
      await rootSpan.stop();
    }
    if (client.nonInteractive) {
      const relOutputDir = relative2(cwd, outputDir);
      client.stdout.write(
        `${JSON.stringify(
          {
            status: AGENT_STATUS.OK,
            outputDir,
            outputDirRelative: relOutputDir.startsWith("..") ? outputDir : relOutputDir,
            target,
            message: "Build completed successfully.",
            next: [
              {
                command: buildCommandWithGlobalFlags("deploy", client.argv),
                when: "Deploy the build output"
              }
            ]
          },
          null,
          2
        )}
`
      );
    }
    return 0;
  } catch (err) {
    if (client.nonInteractive) {
      client.stdout.write(
        `${JSON.stringify(
          {
            status: AGENT_STATUS.ERROR,
            reason: "build_failed",
            message: err?.message ?? String(err),
            next: [
              {
                command: buildCommandWithGlobalFlags("pull --yes", client.argv),
                when: "Ensure project settings are present"
              },
              {
                command: buildCommandWithGlobalFlags(
                  "build --yes",
                  client.argv
                ),
                when: "re-run build"
              }
            ]
          },
          null,
          2
        )}
`
      );
    }
    output_manager_default.prettyError(err);
    buildsJson.error = toEnumerableError(err);
    const buildsJsonPath = join2(outputDir, "builds.json");
    const configJsonPath = join2(outputDir, "config.json");
    await import_fs_extra2.default.outputJSON(buildsJsonPath, buildsJson, {
      spaces: 2
    });
    await import_fs_extra2.default.writeJSON(configJsonPath, { version: 3 }, { spaces: 2 });
    return 1;
  } finally {
    for (const key of envToUnset) {
      delete process.env[key];
    }
    delete process.env.VERCEL_INSTALL_COMPLETED;
    resetCustomInstallCommandSet();
  }
}
async function doBuild(client, project, buildsJson, cwd, outputDir, span, standalone = false) {
  const { localConfigPath } = client;
  const VALID_DEPLOYMENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
  const workPath = join2(cwd, project.settings.rootDirectory || ".");
  const sourceConfigFile = await findSourceVercelConfigFile(workPath);
  let corepackShimDir;
  if (sourceConfigFile) {
    corepackShimDir = await initCorepack({ repoRootPath: cwd });
    const installDepsSpan = span.child("vc.installDeps");
    try {
      const installCommand = project.settings.installCommand;
      if (typeof installCommand === "string") {
        if (installCommand.trim()) {
          output_manager_default.log(`Running install command before config compilation...`);
          await runCustomInstallCommand({
            destPath: workPath,
            installCommand,
            spawnOpts: { env: process.env },
            projectCreatedAt: project.settings.createdAt
          });
        } else {
          output_manager_default.debug("Skipping empty install command");
        }
      } else {
        output_manager_default.log(`Installing dependencies before config compilation...`);
        await runNpmInstall(
          workPath,
          [],
          { env: process.env },
          void 0,
          project.settings.createdAt
        );
      }
    } finally {
      installDepsSpan.stop();
    }
    process.env.VERCEL_INSTALL_COMPLETED = "1";
  }
  const compileResult = await span.child("vc.compileVercelConfig").trace(() => compileVercelConfig(workPath));
  const vercelConfigPath = localConfigPath || compileResult.configPath || join2(workPath, "vercel.json");
  const [pkg, vercelConfig, nowConfig, hasInstrumentation] = await Promise.all([
    readJSONFile(join2(workPath, "package.json")),
    readJSONFile(vercelConfigPath),
    readJSONFile(join2(workPath, "now.json")),
    (0, import_fs_detectors2.detectInstrumentation)(new import_fs_detectors2.LocalFileSystemDetector(workPath))
  ]);
  if (pkg instanceof CantParseJSONFile)
    throw pkg;
  if (vercelConfig instanceof CantParseJSONFile)
    throw vercelConfig;
  if (nowConfig instanceof CantParseJSONFile)
    throw nowConfig;
  if (hasInstrumentation) {
    output_manager_default.debug(
      "OpenTelemetry instrumentation detected. Automatic fetch instrumentation will be disabled."
    );
    process.env.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION = "1";
  }
  if (vercelConfig) {
    vercelConfig[import_client.fileNameSymbol] = compileResult.wasCompiled ? compileResult.sourceFile || DEFAULT_VERCEL_CONFIG_FILENAME : "vercel.json";
  } else if (nowConfig) {
    nowConfig[import_client.fileNameSymbol] = "now.json";
  }
  const localConfig = vercelConfig || nowConfig || {};
  const validateError = validateConfig(localConfig);
  if (validateError) {
    throw validateError;
  }
  if (localConfig.crons && localConfig.crons.length > 0) {
    const cronSecretError = validateCronSecret(process.env.CRON_SECRET);
    if (cronSecretError) {
      throw cronSecretError;
    }
  }
  const projectSettings = {
    ...project.settings,
    ...pickOverrides(localConfig)
  };
  if (process.env.VERCEL_BUILD_MONOREPO_SUPPORT === "1" && pkg?.scripts?.["vercel-build"] === void 0 && projectSettings.rootDirectory !== null && projectSettings.rootDirectory !== ".") {
    await setMonorepoDefaultSettings(cwd, workPath, projectSettings);
  }
  if (process.env.VERCEL_FLAGS_DISABLE_DEFINITION_EMBEDDING !== "1") {
    const { prepareFlagsDefinitions } = await import("@vercel/prepare-flags-definitions");
    await prepareFlagsDefinitions({
      cwd,
      env: process.env,
      userAgentSuffix: ua_default,
      output: output_manager_default
    });
  }
  const files = (await staticFiles(workPath, {})).map(
    (f) => normalizePath(relative2(workPath, f))
  );
  const routesResult = (0, import_routing_utils2.getTransformedRoutes)(localConfig);
  if (routesResult.error) {
    throw routesResult.error;
  }
  if (localConfig.builds && localConfig.functions) {
    throw new NowBuildError2({
      code: "bad_request",
      message: "The `functions` property cannot be used in conjunction with the `builds` property. Please remove one of them.",
      link: "https://vercel.link/functions-and-builds"
    });
  }
  let builds = localConfig.builds || [];
  let zeroConfigRoutes = [];
  let detectedServices;
  let isZeroConfig = false;
  if (builds.length > 0) {
    output_manager_default.warn(
      "Due to `builds` existing in your configuration file, the Build and Development Settings defined in your Project Settings will not apply. Learn More: https://vercel.link/unused-build-settings"
    );
    builds = builds.flatMap((b) => expandBuild(files, b));
  } else {
    isZeroConfig = true;
    const detectedBuilders = await span.child("vc.detectBuilders").trace(
      () => (0, import_fs_detectors2.detectBuilders)(files, pkg, {
        ...localConfig,
        projectSettings,
        ignoreBuildScript: true,
        featHandleMiss: true,
        workPath
      })
    );
    if (detectedBuilders.errors && detectedBuilders.errors.length > 0) {
      throw detectedBuilders.errors[0];
    }
    for (const w of detectedBuilders.warnings) {
      output_manager_default.warn(w.message, null, w.link, w.action || "Learn More");
    }
    if (detectedBuilders.builders) {
      builds = detectedBuilders.builders;
    } else {
      builds = [{ src: "**", use: "@vercel/static" }];
    }
    detectedServices = detectedBuilders.services;
    if (detectedServices && detectedServices.length > 0) {
      const serviceUrlEnvVars = getServiceUrlEnvVars({
        services: detectedServices,
        frameworkList: import_frameworks2.frameworkList,
        currentEnv: process.env,
        deploymentUrl: process.env.VERCEL_URL
      });
      for (const [key, value] of Object.entries(serviceUrlEnvVars)) {
        process.env[key] = value;
        output_manager_default.debug(`Injected service URL env var: ${key}=${value}`);
      }
    }
    zeroConfigRoutes.push(...detectedBuilders.redirectRoutes || []);
    const detectedHostRewriteRoutes = detectedBuilders.hostRewriteRoutes;
    zeroConfigRoutes = (0, import_routing_utils2.appendRoutesToPhase)({
      routes: zeroConfigRoutes,
      newRoutes: detectedHostRewriteRoutes ?? null,
      phase: null
    });
    zeroConfigRoutes.push(
      ...(0, import_routing_utils2.appendRoutesToPhase)({
        routes: [],
        newRoutes: detectedBuilders.rewriteRoutes,
        phase: "filesystem"
      })
    );
    zeroConfigRoutes = (0, import_routing_utils2.appendRoutesToPhase)({
      routes: zeroConfigRoutes,
      newRoutes: detectedBuilders.errorRoutes,
      phase: "error"
    });
    zeroConfigRoutes.push(...detectedBuilders.defaultRoutes || []);
  }
  const builderSpecs = new Set(builds.map((b) => b.use));
  const buildersWithPkgs = await span.child("vc.importBuilders").trace(() => importBuilders(builderSpecs, cwd, span));
  const filesMap = {};
  for (const path of files) {
    const fsPath = join2(workPath, path);
    const { mode } = await import_fs_extra2.default.stat(fsPath);
    filesMap[path] = new FileFsRef({ mode, fsPath });
  }
  const buildStamp = stamp_default();
  await import_fs_extra2.default.mkdirp(outputDir);
  const ops = [];
  const buildsJsonBuilds = new Map(
    builds.map((build) => {
      const builderWithPkg = buildersWithPkgs.get(build.use);
      if (!builderWithPkg) {
        throw new Error(`Failed to load Builder "${build.use}"`);
      }
      const { builder, pkg: builderPkg } = builderWithPkg;
      return [
        build,
        {
          require: builderPkg.name,
          requirePath: builderWithPkg.path,
          apiVersion: builder.version,
          ...build
        }
      ];
    })
  );
  buildsJson.builds = Array.from(buildsJsonBuilds.values());
  await writeBuildJson(buildsJson, outputDir);
  const meta = {
    skipDownload: true,
    cliVersion: pkg_default.version
  };
  const sortedBuilders = sortBuilders(builds);
  const buildResults = /* @__PURE__ */ new Map();
  const overrides = [];
  const repoRootPath = cwd;
  if (!corepackShimDir) {
    corepackShimDir = await initCorepack({ repoRootPath });
  }
  const diagnostics = {};
  const packageManifests = [];
  const hasDetectedServices = detectedServices !== void 0 && detectedServices.length > 0;
  const hasQueueServices = hasDetectedServices && detectedServices.some(isQueueTriggeredService);
  const synthesizedServiceCrons = [];
  const serviceByBuilder = /* @__PURE__ */ new Map();
  if (hasDetectedServices) {
    for (const service of detectedServices) {
      serviceByBuilder.set(service.builder, service);
    }
  }
  for (const build of sortedBuilders) {
    if (typeof build.src !== "string")
      continue;
    const builderWithPkg = buildersWithPkgs.get(build.use);
    if (!builderWithPkg) {
      throw new Error(`Failed to load Builder "${build.use}"`);
    }
    try {
      const { builder, pkg: builderPkg } = builderWithPkg;
      const service = hasDetectedServices ? serviceByBuilder.get(build) : void 0;
      const stripServiceRoutePrefix = !!service?.routePrefix && service.routePrefix !== "/";
      let buildWorkPath = workPath;
      let buildEntrypoint = build.src;
      let buildFiles = filesMap;
      if (service && service.workspace !== ".") {
        const wsPrefix = service.workspace + "/";
        buildWorkPath = join2(workPath, service.workspace);
        buildEntrypoint = build.src.startsWith(wsPrefix) ? build.src.slice(wsPrefix.length) : build.src;
        buildFiles = {};
        for (const [filePath, file] of Object.entries(filesMap)) {
          if (filePath.startsWith(wsPrefix)) {
            buildFiles[filePath.slice(wsPrefix.length)] = file;
          }
        }
        output_manager_default.debug(
          `Service "${service.name}": workspace-rooted build at "${buildWorkPath}", entrypoint "${buildEntrypoint}" (original: "${build.src}")`
        );
      }
      const settingsForEnv = service ? {
        buildCommand: service.buildCommand ?? void 0,
        installCommand: service.installCommand ?? void 0,
        outputDirectory: projectSettings.outputDirectory ?? void 0,
        nodeVersion: projectSettings.nodeVersion ?? void 0
      } : projectSettings;
      for (const key of [
        "buildCommand",
        "installCommand",
        "outputDirectory",
        "nodeVersion"
      ]) {
        const value = settingsForEnv[key];
        const envKey = `VERCEL_PROJECT_SETTINGS_` + key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
        if (typeof value === "string") {
          process.env[envKey] = value;
          output_manager_default.debug(`Setting env ${envKey} to "${value}"`);
        } else {
          delete process.env[envKey];
        }
      }
      const isFrontendBuilder = build.config && "framework" in build.config;
      const builderFramework = build.config?.framework ?? projectSettings.framework;
      let buildConfig;
      if (isZeroConfig) {
        if (service) {
          buildConfig = {
            ...build.config,
            ...hasQueueServices ? { hasWorkerServices: true } : void 0,
            // Override project-level settings with service-specific ones.
            // The project-level framework is "services" which must NOT be
            // propagated to individual builders.
            projectSettings: {
              ...projectSettings,
              framework: service.framework ?? null,
              buildCommand: service.buildCommand ?? null,
              installCommand: service.installCommand ?? null
            },
            installCommand: service.installCommand ?? void 0,
            buildCommand: service.buildCommand ?? void 0,
            framework: builderFramework,
            nodeVersion: projectSettings.nodeVersion,
            bunVersion: localConfig.bunVersion ?? void 0
          };
        } else {
          buildConfig = {
            outputDirectory: projectSettings.outputDirectory ?? void 0,
            ...build.config,
            projectSettings,
            installCommand: projectSettings.installCommand ?? void 0,
            devCommand: projectSettings.devCommand ?? void 0,
            buildCommand: projectSettings.buildCommand ?? void 0,
            framework: projectSettings.framework,
            nodeVersion: projectSettings.nodeVersion,
            bunVersion: localConfig.bunVersion ?? void 0
          };
        }
      } else {
        buildConfig = {
          ...build.config || {},
          bunVersion: localConfig.bunVersion ?? void 0
        };
      }
      const builderSpan = span.child("vc.builder", {
        "builder.name": builderPkg.name,
        "builder.version": builderPkg.version,
        "builder.dynamicallyInstalled": String(
          builderWithPkg.dynamicallyInstalled
        )
      });
      const serviceRoutePrefix = build.config?.routePrefix;
      const serviceWorkspace = build.config?.workspace;
      const buildOptions = {
        files: buildFiles,
        entrypoint: buildEntrypoint,
        workPath: buildWorkPath,
        repoRootPath,
        config: buildConfig,
        meta,
        span: builderSpan,
        ...service ? {
          service: {
            name: service.name,
            type: service.type,
            trigger: service.trigger,
            routePrefix: typeof serviceRoutePrefix === "string" ? serviceRoutePrefix : void 0,
            workspace: typeof serviceWorkspace === "string" ? serviceWorkspace : void 0,
            schedule: service.schedule
          }
        } : void 0
      };
      output_manager_default.debug(
        `Building entrypoint "${build.src}" with "${builderPkg.name}"`
      );
      let buildResult;
      let rawBuildResult;
      try {
        rawBuildResult = await builderSpan.trace(async () => builder.build(buildOptions));
        if (builder.version === -1) {
          const vx = rawBuildResult;
          buildResult = vx.result;
        } else {
          buildResult = rawBuildResult;
        }
        if (!hasDetectedServices && buildConfig.zeroConfig && isFrontendBuilder && "output" in buildResult && !buildResult.routes) {
          const framework2 = import_frameworks2.frameworkList.find(
            (f) => f.slug === buildConfig.framework
          );
          if (framework2) {
            const defaultRoutes = await getFrameworkRoutes(
              framework2,
              buildWorkPath
            );
            buildResult.routes = defaultRoutes;
          }
        }
      } finally {
        try {
          const builderDiagnostics = await builderSpan.child("vc.builder.diagnostics").trace(async () => {
            return await builder.diagnostics?.(buildOptions);
          });
          if (builderDiagnostics) {
            const prefix = service && service.workspace !== "." ? service.workspace + "/" + builderPkg.name + "/" : "";
            for (const [key, value] of Object.entries(builderDiagnostics)) {
              const fullKey = prefix + key;
              if (key.endsWith("package-manifest.json")) {
                try {
                  let data;
                  if (value.type === "FileBlob") {
                    data = value.data.toString();
                  } else {
                    data = await streamToString(value.toStream());
                  }
                  const packageManifest = JSON.parse(data);
                  const validationError = validatePackageManifest(packageManifest);
                  if (validationError) {
                    output_manager_default.warn(
                      `Invalid package-manifest.json from ${fullKey}: ${validationError}`
                    );
                  } else {
                    const workspace = service && service.workspace !== "." ? service.workspace : ".";
                    packageManifests.push({
                      workspace,
                      key: fullKey,
                      manifest: packageManifest,
                      service,
                      builderUse: builderPkg.name
                    });
                  }
                } catch (e) {
                  output_manager_default.debug(
                    `Failed to parse ${fullKey}: ${e instanceof Error ? e.message : String(e)}`
                  );
                }
              } else {
                diagnostics[fullKey] = value;
              }
            }
          }
        } catch (error) {
          output_manager_default.error("Collecting diagnostics failed");
          output_manager_default.debug(error);
        }
      }
      if (buildResult && "output" in buildResult && "runtime" in buildResult.output && "type" in buildResult.output && buildResult.output.type === "Lambda") {
        const lambdaRuntime = buildResult.output.runtime;
        if (getDiscontinuedNodeVersions().some((o) => o.runtime === lambdaRuntime)) {
          throw new NowBuildError2({
            code: "NODEJS_DISCONTINUED_VERSION",
            message: `The Runtime "${build.use}" is using "${lambdaRuntime}", which is discontinued. Please upgrade your Runtime to a more recent version or consult the author for more details.`,
            link: "https://vercel.link/function-runtimes"
          });
        }
      }
      if ("output" in buildResult && buildResult.output && (isBackendBuilder(build) || build.use === "@vercel/python")) {
        const routesJsonPath = join2(buildWorkPath, ".vercel", "routes.json");
        if ((0, import_fs_extra2.existsSync)(routesJsonPath)) {
          try {
            const routesJson = await readJSONFile(routesJsonPath);
            if (routesJson && typeof routesJson === "object" && "routes" in routesJson && Array.isArray(routesJson.routes)) {
              const indexLambda = "index" in buildResult.output ? buildResult.output["index"] : void 0;
              const convertedRoutes = [];
              const convertedOutputs = indexLambda ? { index: indexLambda } : {};
              for (const route of routesJson.routes) {
                if (typeof route.source !== "string") {
                  continue;
                }
                const { src } = (0, import_routing_utils2.sourceToRegex)(route.source);
                const newRoute = {
                  src,
                  dest: route.source
                };
                if (route.methods) {
                  newRoute.methods = route.methods;
                }
                if (route.source === "/") {
                  continue;
                }
                if (indexLambda) {
                  convertedOutputs[route.source] = indexLambda;
                }
                convertedRoutes.push(newRoute);
              }
              buildResult.routes = [
                { handle: "filesystem" },
                ...convertedRoutes,
                { src: "/(.*)", dest: "/" }
              ];
              if (indexLambda) {
                buildResult.output = convertedOutputs;
              }
            }
          } catch (error) {
            output_manager_default.error(`Failed to read routes.json: ${error}`);
          }
        }
      }
      if (hasDetectedServices && service && "routes" in buildResult && Array.isArray(buildResult.routes) && detectedServices) {
        buildResult.routes = scopeRoutesToServiceOwnership({
          routes: buildResult.routes,
          owner: service,
          allServices: detectedServices
        });
      }
      if (service && isQueueTriggeredService(service) && "output" in buildResult) {
        attachQueueServiceTrigger(buildResult.output, service);
      }
      if (service && isScheduleTriggeredService(service) && !("crons" in buildResult && buildResult.crons?.length)) {
        if (typeof service.runtime === "string" && typeof service.schedule === "string" && service.schedule !== "<dynamic>") {
          const cronEntrypoint = service.entrypoint || service.builder.src || "index";
          synthesizedServiceCrons.push({
            path: getInternalServiceCronPath(
              service.name,
              cronEntrypoint,
              service.handlerFunction || "cron"
            ),
            schedule: service.schedule
          });
        } else {
          throw new NowBuildError2({
            code: "CRON_SERVICE_NO_CRONS",
            message: `Scheduled service "${service.name}" did not produce any cron entries. The builder "${builderPkg.name}" may not support scheduled services.`
          });
        }
      }
      let mergedBuildResult = buildResult;
      if ("buildOutputPath" in buildResult) {
        const buildOutputConfigPath = join2(
          buildResult.buildOutputPath,
          "config.json"
        );
        const buildOutputConfig = await readJSONFile(
          buildOutputConfigPath
        );
        if (buildOutputConfig instanceof CantParseJSONFile) {
          throw buildOutputConfig;
        }
        if (buildOutputConfig) {
          if (buildOutputConfig.overrides) {
            overrides.push(buildOutputConfig.overrides);
          }
          if (hasDetectedServices && service && Array.isArray(buildOutputConfig.routes) && detectedServices) {
            buildOutputConfig.routes = scopeRoutesToServiceOwnership({
              routes: buildOutputConfig.routes,
              owner: service,
              allServices: detectedServices
            });
          }
          mergedBuildResult = buildOutputConfig;
        }
      }
      buildResults.set(build, mergedBuildResult);
      let buildOutputLength = 0;
      if ("output" in buildResult) {
        buildOutputLength = Array.isArray(buildResult.output) ? buildResult.output.length : 1;
      }
      ops.push(
        builderSpan.child("vc.builder.writeBuildResult", {
          buildOutputLength: String(buildOutputLength)
        }).trace(
          () => writeBuildResult({
            repoRootPath,
            outputDir,
            buildResult: rawBuildResult,
            build,
            builder,
            builderPkg,
            vercelConfig: localConfig,
            standalone,
            workPath: buildWorkPath,
            service,
            stripServiceRoutePrefix
          })
        ).then(
          (override) => {
            if (override)
              overrides.push(override);
          },
          (err) => err
        )
      );
    } catch (err) {
      const buildJsonBuild = buildsJsonBuilds.get(build);
      if (buildJsonBuild) {
        buildJsonBuild.error = toEnumerableError(err);
      }
      throw err;
    } finally {
      ops.push(
        download(diagnostics, join2(outputDir, "diagnostics")).then(
          () => void 0,
          (err) => err
        )
      );
    }
  }
  if (packageManifests.length > 0) {
    const projectManifest = {};
    for (const {
      workspace,
      manifest,
      service,
      builderUse
    } of packageManifests) {
      projectManifest[`${builderUse}:${workspace}`] = {
        ...manifest,
        workspace,
        builder: builderUse,
        framework: service?.framework,
        serviceName: service?.name,
        serviceType: service?.type,
        routePrefix: service?.routePrefix
      };
    }
    if (Object.keys(projectManifest).length > 0) {
      const projectManifestBlob = new FileBlob({
        data: JSON.stringify(projectManifest)
      });
      diagnostics["project-manifest.json"] = projectManifestBlob;
      ops.push(
        downloadFile(
          projectManifestBlob,
          join2(outputDir, "diagnostics", "project-manifest.json")
        ).then(
          () => void 0,
          (err) => err
        )
      );
    }
  }
  if (corepackShimDir) {
    cleanupCorepack(corepackShimDir);
  }
  const collectSpan = span.child("vc.finalizeBuildOutput");
  const errors = await Promise.all(ops);
  for (const error of errors) {
    if (error) {
      throw error;
    }
  }
  let needBuildsJsonOverride = false;
  const speedInsightsVersion = await getInstalledPackageVersion(
    "@vercel/speed-insights"
  );
  if (speedInsightsVersion) {
    buildsJson.features = {
      ...buildsJson.features ?? {},
      speedInsightsVersion
    };
    needBuildsJsonOverride = true;
  }
  const webAnalyticsVersion = await getInstalledPackageVersion("@vercel/analytics");
  if (webAnalyticsVersion) {
    buildsJson.features = {
      ...buildsJson.features ?? {},
      webAnalyticsVersion
    };
    needBuildsJsonOverride = true;
  }
  if (needBuildsJsonOverride) {
    await writeBuildJson(buildsJson, outputDir);
  }
  const configPath = join2(outputDir, "config.json");
  const existingConfig = await readJSONFile(configPath);
  if (existingConfig instanceof CantParseJSONFile) {
    throw existingConfig;
  }
  if (existingConfig) {
    if ("deploymentId" in existingConfig && typeof existingConfig.deploymentId === "string") {
      const deploymentId = existingConfig.deploymentId;
      if (deploymentId.length > 32) {
        throw new NowBuildError2({
          code: "INVALID_DEPLOYMENT_ID",
          message: `The deploymentId "${deploymentId}" must be 32 characters or less. Please choose a shorter deploymentId in your config.`,
          link: "https://vercel.com/docs/skew-protection#custom-skew-protection-deployment-id"
        });
      }
      if (!VALID_DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
        throw new NowBuildError2({
          code: "INVALID_DEPLOYMENT_ID",
          message: `The deploymentId "${deploymentId}" contains invalid characters. Only alphanumeric characters (a-z, A-Z, 0-9), hyphens (-), and underscores (_) are allowed.`,
          link: "https://vercel.com/docs/skew-protection#custom-skew-protection-deployment-id"
        });
      }
    }
    if (existingConfig.overrides) {
      overrides.push(existingConfig.overrides);
    }
  }
  const builderRoutes = Array.from(
    buildResults.entries()
  ).filter((b) => "routes" in b[1] && Array.isArray(b[1].routes)).map((b) => {
    const build = b[0];
    const buildResult = b[1];
    let entrypoint = build.src;
    if (hasDetectedServices && typeof build.src === "string") {
      const service = serviceByBuilder.get(build);
      if (service && service.type === "web" && typeof service.routePrefix === "string") {
        entrypoint = getServicesMergeEntrypoint(service, build.src);
      }
    }
    return {
      use: build.use,
      entrypoint,
      routes: buildResult.routes
    };
  });
  if (zeroConfigRoutes.length) {
    builderRoutes.unshift({
      use: "@vercel/zero-config-routes",
      entrypoint: "/",
      routes: zeroConfigRoutes
    });
  }
  const mergedRoutes = (0, import_routing_utils2.mergeRoutes)({
    userRoutes: routesResult.routes,
    builds: builderRoutes
  });
  const mergedImages = mergeImages(localConfig.images, buildResults.values());
  const mergedCrons = mergeCrons(
    [...localConfig.crons || [], ...synthesizedServiceCrons],
    buildResults.values()
  );
  const mergedWildcard = mergeWildcard(buildResults.values());
  const mergedDeploymentId = await mergeDeploymentId(
    existingConfig?.deploymentId,
    buildResults.values(),
    workPath
  );
  if (mergedDeploymentId) {
    if (mergedDeploymentId.length > 32) {
      throw new NowBuildError2({
        code: "INVALID_DEPLOYMENT_ID",
        message: `The deploymentId "${mergedDeploymentId}" must be 32 characters or less. Please choose a shorter deploymentId in your config.`,
        link: "https://vercel.com/docs/skew-protection#custom-skew-protection-deployment-id"
      });
    }
    if (!VALID_DEPLOYMENT_ID_PATTERN.test(mergedDeploymentId)) {
      throw new NowBuildError2({
        code: "INVALID_DEPLOYMENT_ID",
        message: `The deploymentId "${mergedDeploymentId}" contains invalid characters. Only alphanumeric characters (a-z, A-Z, 0-9), hyphens (-), and underscores (_) are allowed.`,
        link: "https://vercel.com/docs/skew-protection#custom-skew-protection-deployment-id"
      });
    }
  }
  const mergedOverrides = overrides.length > 0 ? Object.assign({}, ...overrides) : void 0;
  const framework = await getFramework(workPath, buildResults);
  const config = {
    version: 3,
    routes: mergedRoutes,
    images: mergedImages,
    wildcard: mergedWildcard,
    overrides: mergedOverrides,
    framework,
    crons: mergedCrons,
    ...detectedServices && detectedServices.length > 0 && { services: detectedServices },
    ...mergedDeploymentId && { deploymentId: mergedDeploymentId }
  };
  await import_fs_extra2.default.writeJSON(join2(outputDir, "config.json"), config, { spaces: 2 });
  await writeFlagsJSON(buildResults.values(), outputDir);
  collectSpan.stop();
  const relOutputDir = relative2(cwd, outputDir);
  if (!client.nonInteractive) {
    output_manager_default.print(
      `${prependEmoji(
        `Build Completed in ${import_chalk.default.bold(
          relOutputDir.startsWith("..") ? outputDir : relOutputDir
        )} ${import_chalk.default.gray(buildStamp())}`,
        emoji("success")
      )}
`
    );
  }
  if (process.env.VERCEL_ANALYZE_BUILD_OUTPUT === "1") {
    await analyzeVcConfigFiles(cwd, outputDir);
  }
}
function getFunctionUrlPath(vcConfigPath, outputDir) {
  const funcPath = normalizePath(relative2(outputDir, vcConfigPath)).replace(/^functions\//, "").replace(/\/\.vc-config\.json$/, "").replace(/\.func$/, "");
  return "/" + funcPath.split("/").filter((part) => part && part !== "index").join("/");
}
var LAMBDA_SIZE_LIMIT_MB = 250;
function printFileSizeBreakdown(files) {
  const dependencies = /* @__PURE__ */ new Map();
  for (const [bundlePath, sizeMB] of files.entries()) {
    const depKey = bundlePath.split("/").slice(0, 3).join("/");
    dependencies.set(depKey, (dependencies.get(depKey) || 0) + sizeMB);
  }
  const sortedDeps = Array.from(dependencies.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sortedDeps.length > 0) {
    output_manager_default.print(import_chalk.default.yellow("  Large dependencies:\n"));
    for (const [dep, size] of sortedDeps) {
      if (size >= 0.5) {
        output_manager_default.print(
          `    ${import_chalk.default.gray("\u2022")} ${dep}: ${import_chalk.default.bold(size.toFixed(2))} MB
`
        );
      }
    }
    output_manager_default.print("\n");
  }
}
async function analyzeVcConfigFiles(cwd, outputDir) {
  const filesObject = await glob("**/.vc-config.json", {
    cwd: outputDir
  });
  const vcConfigFiles = Object.keys(filesObject).filter((relativePath) => !relativePath.includes(".rsc.func")).map((relativePath) => join2(outputDir, relativePath));
  if (vcConfigFiles.length === 0) {
    output_manager_default.print("No functions to analyze.\n");
    return;
  }
  output_manager_default.print(
    `
Analyzing ${vcConfigFiles.length} function${vcConfigFiles.length === 1 ? "" : "s"}...
`
  );
  const results = await Promise.all(
    vcConfigFiles.map((file) => analyzeSingleFunction(file, cwd, outputDir))
  );
  const validResults = results.filter(
    (r) => r !== null
  );
  const sortedResults = validResults.sort((a, b) => b.size - a.size);
  const exceededFunctions = sortedResults.filter(
    (r) => r.size > LAMBDA_SIZE_LIMIT_MB
  );
  const normalFunctions = sortedResults.filter(
    (r) => r.size <= LAMBDA_SIZE_LIMIT_MB
  );
  if (exceededFunctions.length > 0) {
    output_manager_default.print(
      `${import_chalk.default.red.bold(`\u26A0\uFE0F  Max serverless function size of ${LAMBDA_SIZE_LIMIT_MB} MB uncompressed reached`)}

`
    );
    for (const result of exceededFunctions) {
      output_manager_default.print(
        `${import_chalk.default.red("Function :")} ${import_chalk.default.red.bold(result.path)}
${import_chalk.default.red("Size     :")} ${import_chalk.default.red.bold(result.size.toFixed(2))} MB
`
      );
      printFileSizeBreakdown(result.files);
      output_manager_default.print("\n");
    }
    if (normalFunctions.length > 0) {
      output_manager_default.print(import_chalk.default.cyan(`Other functions:
`));
      for (const result of normalFunctions) {
        output_manager_default.print(
          `${import_chalk.default.cyan(result.path)}: ${import_chalk.default.bold(result.size.toFixed(2))} MB
`
        );
      }
    }
    throw new NowBuildError2({
      code: "NOW_SANDBOX_WORKER_MAX_LAMBDA_SIZE",
      message: `${exceededFunctions.length} function${exceededFunctions.length === 1 ? "" : "s"} exceeded the uncompressed maximum size of ${LAMBDA_SIZE_LIMIT_MB} MB.`,
      link: "https://vercel.link/serverless-function-size",
      action: "Learn More"
    });
  }
}
async function analyzeSingleFunction(file, cwd, outputDir) {
  try {
    const content = await import_fs_extra2.default.readFile(file, "utf8");
    const parsed = JSON.parse(content);
    const funcDir = dirname(file);
    const funcDirStats = getDirectorySizeInMB(funcDir);
    const filePathMap = parsed.filePathMap && typeof parsed.filePathMap === "object" ? Object.entries(parsed.filePathMap).filter(
      (entry) => typeof entry[1] === "string"
    ).map(([bundlePath, sourcePath]) => ({
      bundlePath,
      sourcePath: join2(cwd, sourcePath)
    })) : [];
    const fsRefStats = getTotalFileSizeInMB(filePathMap);
    const totalSize = funcDirStats.size + fsRefStats.size;
    const allFiles = new Map([...funcDirStats.files, ...fsRefStats.files]);
    const functionUrlPath = getFunctionUrlPath(file, outputDir);
    return {
      path: functionUrlPath,
      size: totalSize,
      files: allFiles
    };
  } catch (error) {
    output_manager_default.warn(`Failed to analyze ${file}: ${error}`);
    return null;
  }
}
function getTotalFileSizeInMB(files) {
  let size = 0;
  const filesSizeMap = /* @__PURE__ */ new Map();
  for (const { bundlePath, sourcePath } of files) {
    try {
      const stats = statSync(sourcePath);
      if (stats.isFile()) {
        const fileSizeMB = stats.size / (1024 * 1024);
        size += fileSizeMB;
        filesSizeMap.set(bundlePath, fileSizeMB);
      }
    } catch {
    }
  }
  return { size, files: filesSizeMap };
}
function getDirectorySizeInMB(dir) {
  let size = 0;
  const filesSizeMap = /* @__PURE__ */ new Map();
  try {
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const entryPath = typeof entry === "string" ? entry : entry.toString();
      const fullPath = join2(dir, entryPath);
      try {
        const stats = statSync(fullPath);
        if (stats.isFile()) {
          const fileSizeMB = stats.size / (1024 * 1024);
          size += fileSizeMB;
          filesSizeMap.set(normalizePath(entryPath), fileSizeMB);
        }
      } catch {
      }
    }
  } catch {
  }
  return { size, files: filesSizeMap };
}
async function getFramework(cwd, buildResults) {
  const detectedFramework = await (0, import_fs_detectors2.detectFrameworkRecord)({
    fs: new import_fs_detectors2.LocalFileSystemDetector(cwd),
    frameworkList: import_frameworks2.frameworkList
  });
  if (!detectedFramework) {
    return;
  }
  if (detectedFramework.useRuntime) {
    for (const [build, buildResult] of buildResults.entries()) {
      if ("framework" in buildResult && build.use === detectedFramework.useRuntime.use) {
        return buildResult.framework;
      }
    }
  }
  if (detectedFramework.detectedVersion) {
    if (import_semver.default.valid(detectedFramework.detectedVersion)) {
      return {
        version: detectedFramework.detectedVersion
      };
    }
  }
  const frameworkVersion = (0, import_fs_detectors2.detectFrameworkVersion)(detectedFramework);
  if (frameworkVersion) {
    return {
      version: frameworkVersion
    };
  }
}
function expandBuild(files, build) {
  if (!build.use) {
    throw new NowBuildError2({
      code: `invalid_build_specification`,
      message: "Field `use` is missing in build specification",
      link: "https://vercel.com/docs/concepts/projects/project-configuration#builds",
      action: "View Documentation"
    });
  }
  let src = normalize(build.src || "**").split(sep).join("/");
  if (src === "." || src === "./") {
    throw new NowBuildError2({
      code: `invalid_build_specification`,
      message: "A build `src` path resolves to an empty string",
      link: "https://vercel.com/docs/concepts/projects/project-configuration#builds",
      action: "View Documentation"
    });
  }
  if (src[0] === "/") {
    src = src.substring(1);
  }
  const matches = files.filter(
    (name) => name === src || (0, import_minimatch.default)(name, src, { dot: true })
  );
  return matches.map((m) => {
    return {
      ...build,
      src: m
    };
  });
}
function mergeImages(images, buildResults) {
  for (const result of buildResults) {
    if ("images" in result && result.images) {
      images = Object.assign({}, images, result.images);
    }
  }
  return images;
}
function mergeCrons(crons = [], buildResults) {
  for (const result of buildResults) {
    if ("crons" in result && result.crons) {
      crons = crons.concat(result.crons);
    }
  }
  return crons;
}
function mergeWildcard(buildResults) {
  let wildcard = void 0;
  for (const result of buildResults) {
    if ("wildcard" in result && result.wildcard) {
      if (!wildcard)
        wildcard = [];
      wildcard.push(...result.wildcard);
    }
  }
  return wildcard;
}
async function mergeDeploymentId(existingDeploymentId, buildResults, workPath) {
  if (existingDeploymentId) {
    return existingDeploymentId;
  }
  for (const result of buildResults) {
    if ("deploymentId" in result && result.deploymentId) {
      return result.deploymentId;
    }
  }
  try {
    const routesManifestPath = join2(workPath, ".next", "routes-manifest.json");
    if (await import_fs_extra2.default.pathExists(routesManifestPath)) {
      const routesManifest = await readJSONFile(
        routesManifestPath
      );
      if (routesManifest && !(routesManifest instanceof CantParseJSONFile)) {
        if (routesManifest.deploymentId) {
          return routesManifest.deploymentId;
        }
      }
    }
  } catch {
  }
  return void 0;
}
async function writeFlagsJSON(buildResults, outputDir) {
  const flagsFilePath = join2(outputDir, "flags.json");
  let hasFlags = true;
  const flags = await import_fs_extra2.default.readJSON(flagsFilePath).catch((error) => {
    if (error.code === "ENOENT") {
      hasFlags = false;
      return { definitions: {} };
    }
    throw error;
  });
  for (const result of buildResults) {
    if (!("flags" in result) || !result.flags || !result.flags.definitions)
      continue;
    for (const [key, definition] of Object.entries(result.flags.definitions)) {
      if (result.flags.definitions[key]) {
        output_manager_default.warn(
          `The flag "${key}" was found multiple times. Only its first occurrence will be considered.`
        );
        continue;
      }
      hasFlags = true;
      flags.definitions[key] = definition;
    }
  }
  if (hasFlags) {
    await import_fs_extra2.default.writeJSON(flagsFilePath, flags, { spaces: 2 });
  }
}
async function writeBuildJson(buildsJson, outputDir) {
  await import_fs_extra2.default.writeJSON(join2(outputDir, "builds.json"), buildsJson, { spaces: 2 });
}
async function getFrameworkRoutes(framework, dirPrefix) {
  let routes = [];
  if (typeof framework.defaultRoutes === "function") {
    routes = await framework.defaultRoutes(dirPrefix);
  } else if (Array.isArray(framework.defaultRoutes)) {
    routes = framework.defaultRoutes;
  }
  return routes;
}
function normalizeServiceRoutePrefix(routePrefix) {
  let prefix = routePrefix.startsWith("/") ? routePrefix : `/${routePrefix}`;
  if (prefix !== "/" && prefix.endsWith("/")) {
    prefix = prefix.slice(0, -1);
  }
  return prefix;
}
function getServicesMergeEntrypoint(service, buildSrc) {
  const routePrefix = typeof service.routePrefix === "string" ? service.routePrefix : "/";
  const normalized = normalizeServiceRoutePrefix(routePrefix);
  const sortKey = String(1e4 - normalized.length).padStart(5, "0");
  return `svc:${sortKey}:${normalized}:${service.name}:${buildSrc}`;
}
function attachQueueServiceTrigger(buildOutput, service) {
  const topics = getServiceQueueTopicConfigs(service);
  const consumer = sanitizeConsumerName(
    getInternalServiceFunctionPath(service.name)
  );
  if (service.builder.use !== "@vercel/python" && topics.length > 1) {
    throw new Error(
      `Worker service "${service.name}" has ${topics.length} topics, but multiple topics are only supported for Python workers.`
    );
  }
  for (const topicConfig of topics) {
    const trigger = {
      type: "queue/v2beta",
      topic: topicConfig.topic,
      consumer
    };
    if (topicConfig.retryAfterSeconds !== void 0) {
      trigger.retryAfterSeconds = topicConfig.retryAfterSeconds;
    }
    if (topicConfig.initialDelaySeconds !== void 0) {
      trigger.initialDelaySeconds = topicConfig.initialDelaySeconds;
    }
    if (isLambda(buildOutput)) {
      appendQueueTrigger(buildOutput, trigger);
    } else {
      for (const output of Object.values(buildOutput)) {
        if (isLambda(output)) {
          appendQueueTrigger(output, trigger);
        }
      }
    }
  }
}
function appendQueueTrigger(lambda, trigger) {
  const existingTriggers = Array.isArray(lambda.experimentalTriggers) ? lambda.experimentalTriggers : [];
  const alreadyConfigured = existingTriggers.some(
    (existing) => existing.type === trigger.type && existing.topic === trigger.topic && existing.consumer === trigger.consumer
  );
  if (!alreadyConfigured) {
    lambda.experimentalTriggers = [...existingTriggers, trigger];
  }
}
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
var INTEGRATIONS_POLL_INTERVAL_MS = 5e3;
var INTEGRATIONS_POLL_TIMEOUT_MS = 3 * 60 * 1e3;
async function fetchDeploymentBuildEnv(client, deploymentId) {
  const deadline = Date.now() + INTEGRATIONS_POLL_TIMEOUT_MS;
  let isPolling = false;
  while (Date.now() < deadline) {
    try {
      return await pullEnvRecords(client, deploymentId, "vercel-cli:pull");
    } catch (err) {
      if (err && typeof err === "object" && "integrationsStatus" in err && err.integrationsStatus === "pending") {
        if (!isPolling) {
          output_manager_default.spinner(
            "Waiting for deployment integrations to finish provisioning..."
          );
          isPolling = true;
        }
        await new Promise(
          (resolve2) => setTimeout(resolve2, INTEGRATIONS_POLL_INTERVAL_MS)
        );
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    "Timed out waiting for deployment integrations to complete provisioning."
  );
}
export {
  main as default
};
