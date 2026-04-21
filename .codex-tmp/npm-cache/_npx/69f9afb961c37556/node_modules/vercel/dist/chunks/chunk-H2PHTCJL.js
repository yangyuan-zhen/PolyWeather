import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  getLocalPathConfig
} from "./chunk-KUY7VLTK.js";
import {
  table
} from "./chunk-GE6G37P4.js";
import {
  VERCEL_DIR_PROJECT,
  VERCEL_DIR_README,
  checkExistsAndConnect,
  compileVercelConfig,
  createProject,
  detectProjects,
  findSourceVercelConfigFile,
  getLinkedProject,
  getProjectByNameOrId,
  getServicesConfigWriteBlocker,
  getTeams,
  getUser,
  getVercelDirectory,
  humanizePath,
  isDirectory,
  linkFolderToProject,
  parseGitConfig,
  pluckRemoteUrls,
  readJSONFile,
  require_dist3 as require_dist,
  require_frameworks,
  require_lib,
  require_slugify,
  selectAndParseRemoteUrl,
  selectOrg,
  writeServicesConfig
} from "./chunk-U7MQBM3F.js";
import {
  printError
} from "./chunk-RFMC2QXQ.js";
import {
  CantParseJSONFile,
  ProjectNotFound,
  isAPIError
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/validate-paths.ts
var import_fs_extra = __toESM(require_lib(), 1);
var import_chalk = __toESM(require_source(), 1);
import { homedir } from "os";
async function validateRootDirectory(cwd, path2, errorSuffix = "") {
  const pathStat = await (0, import_fs_extra.lstat)(path2).catch(() => null);
  const suffix = errorSuffix ? ` ${errorSuffix}` : "";
  if (!pathStat) {
    output_manager_default.error(
      `The provided path ${import_chalk.default.cyan(
        `\u201C${humanizePath(path2)}\u201D`
      )} does not exist.${suffix}`
    );
    return false;
  }
  if (!pathStat.isDirectory()) {
    output_manager_default.error(
      `The provided path ${import_chalk.default.cyan(
        `\u201C${humanizePath(path2)}\u201D`
      )} is a file, but expected a directory.${suffix}`
    );
    return false;
  }
  if (!path2.startsWith(cwd)) {
    output_manager_default.error(
      `The provided path ${import_chalk.default.cyan(
        `\u201C${humanizePath(path2)}\u201D`
      )} is outside of the project.${suffix}`
    );
    return false;
  }
  return true;
}
async function validatePaths(client, paths) {
  if (paths.length > 1) {
    output_manager_default.error(`Can't deploy more than one path.`);
    return { valid: false, exitCode: 1 };
  }
  const path2 = paths[0];
  const pathStat = await (0, import_fs_extra.lstat)(path2).catch(() => null);
  if (!pathStat) {
    output_manager_default.error(`Could not find ${import_chalk.default.cyan(`\u201C${humanizePath(path2)}\u201D`)}`);
    return { valid: false, exitCode: 1 };
  }
  if (!pathStat.isDirectory()) {
    output_manager_default.prettyError({
      message: "Support for single file deployments has been removed.",
      link: "https://vercel.link/no-single-file-deployments"
    });
    return { valid: false, exitCode: 1 };
  }
  if (path2 === homedir()) {
    const shouldDeployHomeDirectory = await client.input.confirm(
      `You are deploying your home directory. Do you want to continue?`,
      false
    );
    if (!shouldDeployHomeDirectory) {
      output_manager_default.print(`Canceled
`);
      return { valid: false, exitCode: 0 };
    }
  }
  return { valid: true, path: path2 };
}

// src/util/config/read-config.ts
async function readConfig(dir) {
  let pkgFilePath;
  try {
    const compileResult = await compileVercelConfig(dir);
    pkgFilePath = compileResult.configPath || getLocalPathConfig(dir);
  } catch (err) {
    if (err instanceof Error) {
      return err;
    }
    throw err;
  }
  const result = await readJSONFile(pkgFilePath);
  if (result instanceof CantParseJSONFile) {
    return result;
  }
  if (result) {
    return result;
  }
  return null;
}

// src/util/input/display-services.ts
var import_frameworks = __toESM(require_frameworks(), 1);
import {
  getServiceQueueTopics,
  isQueueTriggeredService,
  isScheduleTriggeredService
} from "@vercel/build-utils";
var chalk2 = require_source();
var frameworksBySlug = new Map(import_frameworks.frameworkList.map((f) => [f.slug, f]));
var frameworkColors = {
  // JavaScript/TypeScript frameworks
  nextjs: chalk2.white,
  vite: chalk2.magenta,
  nuxtjs: chalk2.green,
  remix: chalk2.cyan,
  astro: chalk2.magenta,
  gatsby: chalk2.magenta,
  svelte: chalk2.red,
  sveltekit: chalk2.red,
  solidstart: chalk2.blue,
  angular: chalk2.red,
  vue: chalk2.green,
  ember: chalk2.red,
  preact: chalk2.magenta,
  // Python frameworks
  fastapi: chalk2.green,
  flask: chalk2.cyan,
  // Node frameworks
  express: chalk2.yellow,
  nest: chalk2.red,
  hono: chalk2.yellowBright
};
var runtimeColors = {
  node: chalk2.green,
  python: chalk2.blue,
  go: chalk2.cyan,
  ruby: chalk2.red,
  rust: chalk2.yellowBright
};
function getFrameworkName(slug) {
  if (!slug)
    return void 0;
  return frameworksBySlug.get(slug)?.name;
}
function formatRoutePrefix(routePrefix) {
  if (routePrefix === "/") {
    return "/";
  }
  const normalized = routePrefix.startsWith("/") ? routePrefix : `/${routePrefix}`;
  return `${normalized}/*`;
}
var jobTriggerLabels = {
  queue: "Job/Queue",
  schedule: "Job/Schedule",
  workflow: "Job/Workflow"
};
function getServiceDescriptionInfo(service) {
  if (service.type === "worker" || service.type === "job" || service.type === "cron") {
    const typeLabel = service.type === "worker" ? "Worker" : jobTriggerLabels[service.trigger ?? ""] ?? "Job";
    const typeColorFn = service.type === "worker" ? chalk2.magenta : chalk2.cyan;
    if (service.runtime) {
      const runtimeName = service.runtime.charAt(0).toUpperCase() + service.runtime.slice(1);
      const runtimeColorFn = runtimeColors[service.runtime] || chalk2.yellow;
      const label = `${typeLabel}${chalk2.white("/")}${runtimeColorFn(runtimeName)}`;
      return { label, colorFn: typeColorFn };
    }
    return { label: typeLabel, colorFn: typeColorFn };
  }
  const frameworkName = getFrameworkName(service.framework);
  if (frameworkName && service.framework) {
    const colorFn = frameworkColors[service.framework] || chalk2.cyan;
    return { label: frameworkName, colorFn };
  } else if (service.runtime) {
    const normalizedRuntime = service.runtime.toLowerCase().replace(/@.*$/, "");
    const colorFn = runtimeColors[normalizedRuntime] || chalk2.yellow;
    return { label: service.runtime, colorFn };
  } else if (service.builder?.use) {
    return { label: service.builder.use, colorFn: chalk2.magenta };
  }
  return { label: "unknown", colorFn: chalk2.dim };
}
function getServiceTarget(service) {
  if (isScheduleTriggeredService(service)) {
    return `schedule: ${service.schedule ?? "none"}`;
  }
  if (isQueueTriggeredService(service)) {
    const topics = getServiceQueueTopics(service);
    return `topics: ${topics.join(", ")}`;
  }
  if (service.type === "job" && service.trigger === "workflow") {
    return "workflow";
  }
  return service.routePrefix ? formatRoutePrefix(service.routePrefix) : "no route";
}
function displayDetectedServices(services) {
  output_manager_default.print(`Detected services:
`);
  const outputOrder = {
    web: 0,
    cron: 1,
    job: 1,
    worker: 2
  };
  const sorted = [...services].sort(
    (a, b) => (outputOrder[a.type] ?? 3) - (outputOrder[b.type] ?? 3)
  );
  const rows = sorted.map((service) => {
    const descInfo = getServiceDescriptionInfo(service);
    const target = getServiceTarget(service);
    return [
      `\u2022 ${service.name}`,
      descInfo.colorFn(`[${descInfo.label}]`),
      chalk2.dim("\u2192"),
      target
    ];
  });
  const tableOutput = table(rows, { align: ["l", "l", "l", "l"], hsep: 2 });
  output_manager_default.print(`${tableOutput}
`);
}
function displayServicesConfigNote(configFileName = "vercel.json") {
  output_manager_default.print(
    `
${chalk2.dim(`Services are configured via ${configFileName}.`)}
`
  );
}
function displayServiceErrors(errors) {
  for (const error of errors) {
    output_manager_default.warn(error.message);
  }
}

// src/util/link/setup-and-link.ts
var import_chalk6 = __toESM(require_source(), 1);
var import_fs_extra2 = __toESM(require_lib(), 1);
import { join as join2, basename } from "path";

// src/util/input/input-project.ts
var import_chalk2 = __toESM(require_source(), 1);
var import_slugify = __toESM(require_slugify(), 1);
async function inputProject(client, org, detectedProjectName, autoConfirm = false, skipAutoDetect = false) {
  const slugifiedName = (0, import_slugify.default)(detectedProjectName);
  let detectedProject = null;
  if (!skipAutoDetect) {
    output_manager_default.spinner("Searching for existing projects\u2026", 1e3);
    const [project, slugifiedProject] = await Promise.all([
      getProjectByNameOrId(client, detectedProjectName, org.id),
      slugifiedName !== detectedProjectName ? getProjectByNameOrId(client, slugifiedName, org.id) : null
    ]);
    detectedProject = !(project instanceof ProjectNotFound) ? project : !(slugifiedProject instanceof ProjectNotFound) ? slugifiedProject : null;
    if (detectedProject && !detectedProject.id) {
      throw new Error(`Detected linked project does not have "id".`);
    }
    output_manager_default.stopSpinner();
  }
  if (autoConfirm) {
    return detectedProject || detectedProjectName;
  }
  if (client.nonInteractive) {
    if (detectedProject) {
      return detectedProject;
    }
    const err = new Error("Confirmation required");
    err.code = "HEADLESS";
    throw err;
  }
  let shouldLinkProject;
  if (!detectedProject) {
    shouldLinkProject = await client.input.confirm(
      `Link to existing project?`,
      false
    );
  } else {
    if (await client.input.confirm(
      `Found project ${import_chalk2.default.cyan(
        `\u201C${org.slug}/${detectedProject.name}\u201D`
      )}. Link to it?`,
      true
    )) {
      return detectedProject;
    }
    shouldLinkProject = await client.input.confirm(
      `Link to different existing project?`,
      true
    );
  }
  if (shouldLinkProject) {
    const firstPage = await client.fetch(`/v9/projects?limit=100`, { accountId: org.id });
    const projects = firstPage.projects;
    const hasMoreProjects = firstPage.pagination.next !== null;
    if (projects.length === 0) {
      output_manager_default.log(
        `No existing projects found under ${import_chalk2.default.bold(org.slug)}. Creating new project.`
      );
    } else if (hasMoreProjects) {
      let toLink;
      await client.input.text({
        message: "What's the name of your existing project?",
        validate: async (val) => {
          if (!val) {
            return "Project name cannot be empty";
          }
          const project = await getProjectByNameOrId(client, val, org.id);
          if (project instanceof ProjectNotFound) {
            return "Project not found";
          }
          toLink = project;
          return true;
        }
      });
      return toLink;
    } else {
      const choices = projects.sort((a, b) => b.updatedAt - a.updatedAt).map((project) => ({
        name: project.name,
        value: project
      }));
      const toLink = await client.input.select({
        message: "Which existing project do you want to link?",
        choices
      });
      return toLink;
    }
  }
  return await client.input.text({
    message: `What\u2019s your project\u2019s name?`,
    default: !detectedProject ? slugifiedName : void 0,
    validate: async (val) => {
      if (!val) {
        return "Project name cannot be empty";
      }
      const project = await getProjectByNameOrId(client, val, org.id);
      if (!(project instanceof ProjectNotFound)) {
        return "Project already exists";
      }
      return true;
    }
  });
}

// src/util/input/input-root-directory.ts
var import_chalk3 = __toESM(require_source(), 1);
import { normalizePath } from "@vercel/build-utils";
import path from "path";
async function inputRootDirectory(client, cwd, autoConfirm = false) {
  if (autoConfirm) {
    return null;
  }
  while (true) {
    const rootDirectory = await client.input.text({
      message: `In which directory is your code located?`,
      transformer: (input) => {
        return `${import_chalk3.default.dim(`./`)}${input}`;
      }
    });
    if (!rootDirectory) {
      return null;
    }
    const normal = path.normalize(rootDirectory);
    if (normal === "." || normal === "./") {
      return null;
    }
    const fullPath = path.join(cwd, normal);
    if (await validateRootDirectory(
      cwd,
      fullPath,
      "Please choose a different one."
    ) === false) {
      continue;
    }
    return normalizePath(normal);
  }
}

// src/util/input/edit-project-settings.ts
var import_chalk4 = __toESM(require_source(), 1);
var import_frameworks2 = __toESM(require_frameworks(), 1);

// src/util/is-setting-value.ts
function isSettingValue(setting) {
  return setting && typeof setting.value === "string";
}

// src/util/input/edit-project-settings.ts
var settingMap = {
  buildCommand: "Build Command",
  devCommand: "Development Command",
  commandForIgnoringBuildStep: "Ignore Command",
  installCommand: "Install Command",
  outputDirectory: "Output Directory",
  framework: "Framework"
};
var settingKeys = Object.keys(settingMap).sort();
async function editProjectSettings(client, projectSettings, framework, autoConfirm, localConfigurationOverrides, configFileName = "vercel.json") {
  const settings = Object.assign(
    {
      buildCommand: null,
      devCommand: null,
      framework: null,
      commandForIgnoringBuildStep: null,
      installCommand: null,
      outputDirectory: null
    },
    projectSettings
  );
  const hasLocalConfigurationOverrides = localConfigurationOverrides && Object.values(localConfigurationOverrides ?? {}).some(Boolean);
  if (hasLocalConfigurationOverrides) {
    for (const setting of settingKeys) {
      const localConfigValue = localConfigurationOverrides[setting];
      if (localConfigValue)
        settings[setting] = localConfigValue;
    }
    output_manager_default.print(`Local settings detected in ${configFileName}:
`);
    for (const setting of settingKeys) {
      const override = localConfigurationOverrides[setting];
      if (override) {
        output_manager_default.print(
          `${import_chalk4.default.dim(
            `- ${import_chalk4.default.bold(`${settingMap[setting]}:`)} ${override}`
          )}
`
        );
      }
    }
    if (localConfigurationOverrides.framework) {
      const overrideFramework = import_frameworks2.frameworkList.find(
        (f) => f.slug === localConfigurationOverrides.framework
      );
      if (overrideFramework) {
        framework = overrideFramework;
        output_manager_default.print(
          `Merging default Project Settings for ${framework.name}. Previously listed overrides are prioritized.
`
        );
      }
    }
  }
  if (!framework) {
    settings.framework = null;
    return settings;
  }
  const styledFramework = (frameworkName) => {
    const frameworkStyle = {
      text: frameworkName,
      color: import_chalk4.default.blue
    };
    if (frameworkName === "Hono") {
      frameworkStyle.text = "\u{1F525} Hono";
      frameworkStyle.color = import_chalk4.default.hex("#FFA500");
    }
    return import_chalk4.default.bold(frameworkStyle.color(frameworkStyle.text));
  };
  output_manager_default.log(
    !framework.slug ? `No framework detected. Default Project Settings:
` : `Auto-detected Project Settings for ${styledFramework(framework.name)}
`
  );
  settings.framework = framework.slug;
  if (!framework.slug) {
    for (const setting of settingKeys) {
      if (setting === "framework" || setting === "commandForIgnoringBuildStep") {
        continue;
      }
      const defaultSetting = framework.settings[setting];
      const override = localConfigurationOverrides?.[setting];
      if (!override && defaultSetting) {
        output_manager_default.print(
          `${import_chalk4.default.dim(
            `- ${import_chalk4.default.bold(`${settingMap[setting]}:`)} ${isSettingValue(defaultSetting) ? defaultSetting.value : import_chalk4.default.italic(`${defaultSetting.placeholder}`)}`
          )}
`
        );
      }
    }
  }
  if (autoConfirm || !await client.input.confirm("Want to modify these settings?", false)) {
    return settings;
  }
  const choices = settingKeys.reduce(
    (acc, setting) => {
      const skip = setting === "framework" || setting === "commandForIgnoringBuildStep" || setting === "installCommand" || localConfigurationOverrides?.[setting];
      if (skip)
        return acc;
      return [...acc, { name: settingMap[setting], value: setting }];
    },
    []
  );
  const settingFields = await client.input.checkbox({
    message: "Which settings would you like to overwrite (select multiple)?",
    choices
  });
  for (const setting of settingFields) {
    const field = settingMap[setting];
    settings[setting] = await client.input.text({
      message: `What's your ${import_chalk4.default.bold(field)}?`
    });
  }
  return settings;
}

// src/util/link/setup-and-link.ts
var import_frameworks3 = __toESM(require_frameworks(), 1);

// src/util/input/vercel-auth.ts
var import_chalk5 = __toESM(require_source(), 1);
var DEFAULT_VERCEL_AUTH_SETTING = "standard";
var OPTIONS = {
  message: `What setting do you want to use for Vercel Authentication?`,
  default: DEFAULT_VERCEL_AUTH_SETTING,
  choices: [
    {
      description: "Standard Protection (recommended)",
      name: "standard",
      value: "standard"
    },
    {
      description: "No Protection (all deployments will be public)",
      name: "none",
      value: "none"
    }
  ]
};
async function vercelAuth(client, {
  autoConfirm = false
}) {
  if (autoConfirm || await client.input.confirm(
    `Want to use the default Deployment Protection settings? ${import_chalk5.default.dim(`(Vercel Authentication: Standard Protection)`)}`,
    true
  )) {
    return DEFAULT_VERCEL_AUTH_SETTING;
  }
  const vercelAuth2 = await client.input.select(OPTIONS);
  return vercelAuth2;
}

// src/util/link/services-setup.ts
var import_fs_detectors = __toESM(require_dist(), 1);
import { normalizePath as normalizePath2 } from "@vercel/build-utils";
import { join, relative } from "path";
var SERVICES_DOCS_URL = "https://vercel.com/docs/services";
var INFERRED_SERVICES_PROMPT = "Multiple services were detected. How would you like to set up this project?";
async function getServicesSetupState(workPath) {
  const detectServicesResult = await (0, import_fs_detectors.detectServices)({
    fs: new import_fs_detectors.LocalFileSystemDetector(workPath)
  });
  const hasConfiguredServices = detectServicesResult.resolved.source === "configured";
  const inferredServices = hasConfiguredServices ? null : detectServicesResult.inferred;
  const inferredServicesWriteBlocker = inferredServices ? await getServicesConfigWriteBlocker(workPath, inferredServices.config) : null;
  return {
    detectServicesResult,
    hasConfiguredServices,
    inferredServices,
    inferredServicesWriteBlocker
  };
}
function displayConfiguredServicesSetup(detectServicesResult, configFileName = "vercel.json") {
  if (detectServicesResult.services.length > 0) {
    displayDetectedServices(detectServicesResult.services);
  }
  if (detectServicesResult.errors.length > 0) {
    displayServiceErrors(detectServicesResult.errors);
  }
  displayServicesConfigNote(configFileName);
}
function formatDetectedServicesSummary(services) {
  if (services.length === 0) {
    return "";
  }
  if (services.length === 1) {
    return `"${services[0].name}"`;
  }
  if (services.length === 2) {
    return `"${services[0].name}" + "${services[1].name}"`;
  }
  const othersCount = services.length - 2;
  return `"${services[0].name}" + "${services[1].name}" + ${othersCount} ${othersCount === 1 ? "other" : "others"}`;
}
function toProjectRootDirectory(projectPath, selectedPath) {
  const rootDirectory = normalizePath2(relative(projectPath, selectedPath));
  return rootDirectory === "" ? null : rootDirectory;
}
async function promptForInferredServicesSetup({
  client,
  autoConfirm,
  nonInteractive,
  workPath,
  inferred,
  inferredWriteBlocker,
  allowChooseDifferentProjectDirectory = false
}) {
  if (!inferred) {
    return null;
  }
  if (inferredWriteBlocker) {
    output_manager_default.warn(
      `Multiple services were detected, but your existing project config uses \`${inferredWriteBlocker}\`. To deploy multiple services in one project, see ${output_manager_default.link("Services", SERVICES_DOCS_URL)}.`
    );
    return null;
  }
  displayDetectedServices(inferred.services);
  let choice = null;
  if (autoConfirm) {
    choice = { type: "services" };
  } else if (!nonInteractive) {
    const webServices = inferred.services.filter(
      (service) => service.type === "web"
    );
    const choices = [
      {
        name: `Set up project with all detected services: ${formatDetectedServicesSummary(
          inferred.services
        )}`,
        value: "services"
      },
      ...webServices.map((service, index) => ({
        name: `Set up project with "${service.name}"`,
        value: `single-app:${index}`
      })),
      ...allowChooseDifferentProjectDirectory ? [
        {
          name: "Choose a different root directory",
          value: "project-directory"
        }
      ] : []
    ];
    const selected = await client.input.select({
      message: INFERRED_SERVICES_PROMPT,
      choices
    });
    if (selected === "services") {
      choice = { type: "services" };
    } else if (selected === "project-directory") {
      choice = { type: "project-directory" };
    } else if (typeof selected === "string" && selected.startsWith("single-app:")) {
      const index = Number.parseInt(selected.slice("single-app:".length), 10);
      const service = webServices[index];
      if (service) {
        choice = {
          type: "single-app",
          selectedPath: service.workspace === "." ? workPath : join(workPath, service.workspace)
        };
      }
    }
  }
  if (choice?.type !== "services") {
    return choice;
  }
  const { configFileName } = await writeServicesConfig(
    workPath,
    inferred.config
  );
  output_manager_default.log(`Added services configuration to ${configFileName}.`);
  return { type: "services" };
}

// src/util/projects/search-project-across-teams.ts
var import_slugify2 = __toESM(require_slugify(), 1);
async function searchProjectAcrossTeams(client, projectName) {
  const [user, teams] = await Promise.all([getUser(client), getTeams(client)]);
  const orgs = [
    ...user.version === "northstar" ? [] : [{ type: "user", id: user.id, slug: user.username }],
    ...teams.map((t) => ({
      type: "team",
      id: t.id,
      slug: t.slug
    }))
  ];
  const slugifiedName = (0, import_slugify2.default)(projectName);
  const searchNames = [projectName];
  if (slugifiedName !== projectName) {
    searchNames.push(slugifiedName);
  }
  const searchPromises = orgs.flatMap(
    (org) => searchNames.map(
      (name) => getProjectByNameOrId(client, name, org.id).then(
        (result) => result instanceof ProjectNotFound ? null : { project: result, org }
      ).catch(() => null)
    )
  );
  const results = await Promise.all(searchPromises);
  const seen = /* @__PURE__ */ new Set();
  const matches = [];
  for (const r of results) {
    if (r && r.project.id && !seen.has(r.project.id)) {
      seen.add(r.project.id);
      matches.push(r);
    }
  }
  return matches;
}

// src/util/link/setup-and-link.ts
async function setupAndLink(client, path2, {
  autoConfirm = false,
  forceDelete = false,
  link,
  successEmoji = "link",
  setupMsg = "Set up",
  projectName = basename(path2),
  nonInteractive = false,
  pullEnv = true,
  v0,
  searchAcrossTeams = false
}) {
  const { config } = client;
  if (!isDirectory(path2)) {
    output_manager_default.error(`Expected directory but found file: ${path2}`);
    return { status: "error", exitCode: 1, reason: "PATH_IS_FILE" };
  }
  if (!link) {
    link = await getLinkedProject(client, path2);
  }
  const isTTY = client.stdin.isTTY;
  let rootDirectory = null;
  let newProjectName;
  let org;
  if (!forceDelete && link.status === "linked") {
    return link;
  }
  if (forceDelete) {
    const vercelDir = getVercelDirectory(path2);
    (0, import_fs_extra2.remove)(join2(vercelDir, VERCEL_DIR_README));
    (0, import_fs_extra2.remove)(join2(vercelDir, VERCEL_DIR_PROJECT));
  }
  if (!isTTY && !autoConfirm && !nonInteractive) {
    return { status: "error", exitCode: 1, reason: "HEADLESS" };
  }
  const shouldStartSetup = autoConfirm || nonInteractive || await client.input.confirm(
    `${setupMsg} ${import_chalk6.default.cyan(`\u201C${humanizePath(path2)}\u201D`)}?`,
    true
  );
  if (!shouldStartSetup) {
    output_manager_default.print(`Canceled. Project not set up.
`);
    return { status: "not_linked", org: null, project: null };
  }
  let skipAutoDetect = false;
  if (searchAcrossTeams) {
    let crossTeamMatches = [];
    output_manager_default.spinner("Searching for existing projects\u2026", 1e3);
    try {
      crossTeamMatches = await searchProjectAcrossTeams(client, projectName);
    } catch (err) {
      output_manager_default.debug(`Cross-team search failed: ${err}`);
    } finally {
      output_manager_default.stopSpinner();
    }
    if (crossTeamMatches.length === 1) {
      const match = crossTeamMatches[0];
      if (autoConfirm || nonInteractive) {
        config.currentTeam = match.org.type === "team" ? match.org.id : void 0;
        await linkFolderToProject(
          client,
          path2,
          { projectId: match.project.id, orgId: match.org.id },
          match.project.name,
          match.org.slug,
          successEmoji,
          autoConfirm,
          pullEnv
        );
        return { status: "linked", org: match.org, project: match.project };
      }
      const confirmed = await client.input.confirm(
        `Found project ${import_chalk6.default.blue(match.org.slug)}/${match.project.name}. Link to it?`,
        true
      );
      if (confirmed) {
        config.currentTeam = match.org.type === "team" ? match.org.id : void 0;
        await linkFolderToProject(
          client,
          path2,
          { projectId: match.project.id, orgId: match.org.id },
          match.project.name,
          match.org.slug,
          successEmoji,
          autoConfirm,
          pullEnv
        );
        return { status: "linked", org: match.org, project: match.project };
      }
      skipAutoDetect = true;
    } else if (crossTeamMatches.length > 1) {
      const currentTeamMatch = autoConfirm ? crossTeamMatches.find((m) => m.org.id === config.currentTeam) : void 0;
      if (currentTeamMatch) {
        config.currentTeam = currentTeamMatch.org.type === "team" ? currentTeamMatch.org.id : void 0;
        await linkFolderToProject(
          client,
          path2,
          {
            projectId: currentTeamMatch.project.id,
            orgId: currentTeamMatch.org.id
          },
          currentTeamMatch.project.name,
          currentTeamMatch.org.slug,
          successEmoji,
          autoConfirm,
          pullEnv
        );
        return {
          status: "linked",
          org: currentTeamMatch.org,
          project: currentTeamMatch.project
        };
      }
      if (!nonInteractive) {
        const choices = crossTeamMatches.map((m) => ({
          name: `${import_chalk6.default.blue(m.org.slug)}/${m.project.name}`,
          value: m
        }));
        choices.push({
          name: "Don't link to an existing project",
          value: null
        });
        const selected = await client.input.select({
          message: "Found matching projects across teams. Which one do you want to link?",
          choices
        });
        if (selected) {
          config.currentTeam = selected.org.type === "team" ? selected.org.id : void 0;
          await linkFolderToProject(
            client,
            path2,
            { projectId: selected.project.id, orgId: selected.org.id },
            selected.project.name,
            selected.org.slug,
            successEmoji,
            autoConfirm,
            pullEnv
          );
          return {
            status: "linked",
            org: selected.org,
            project: selected.project
          };
        }
        skipAutoDetect = true;
      }
    }
  }
  try {
    org = await selectOrg(
      client,
      "Which scope should contain your project?",
      autoConfirm
    );
  } catch (err) {
    if (isAPIError(err)) {
      if (err.code === "NOT_AUTHORIZED") {
        output_manager_default.prettyError(err);
        return { status: "error", exitCode: 1, reason: "NOT_AUTHORIZED" };
      }
      if (err.code === "TEAM_DELETED") {
        output_manager_default.prettyError(err);
        return { status: "error", exitCode: 1, reason: "TEAM_DELETED" };
      }
    }
    throw err;
  }
  let projectOrNewProjectName;
  try {
    projectOrNewProjectName = await inputProject(
      client,
      org,
      projectName,
      autoConfirm,
      skipAutoDetect
    );
  } catch (err) {
    if (err instanceof Error && err.code === "HEADLESS") {
      return { status: "error", exitCode: 1, reason: "HEADLESS" };
    }
    throw err;
  }
  if (typeof projectOrNewProjectName === "string") {
    newProjectName = projectOrNewProjectName;
  } else {
    const project = projectOrNewProjectName;
    await linkFolderToProject(
      client,
      path2,
      {
        projectId: project.id,
        orgId: org.id
      },
      project.name,
      org.slug,
      successEmoji,
      autoConfirm,
      pullEnv
    );
    return { status: "linked", org, project };
  }
  config.currentTeam = org.type === "team" ? org.id : void 0;
  const rootServicesSetup = await getServicesSetupState(path2);
  const configFileName = await findSourceVercelConfigFile(path2) ?? "vercel.json";
  try {
    let settings = {};
    let pathWithRootDirectory = path2;
    let rootInferredServicesChoice = null;
    if (!rootServicesSetup.hasConfiguredServices) {
      rootInferredServicesChoice = await promptForInferredServicesSetup({
        client,
        autoConfirm,
        nonInteractive,
        workPath: path2,
        inferred: rootServicesSetup.inferredServices,
        inferredWriteBlocker: rootServicesSetup.inferredServicesWriteBlocker,
        allowChooseDifferentProjectDirectory: true
      });
    }
    if (rootServicesSetup.hasConfiguredServices) {
      displayConfiguredServicesSetup(
        rootServicesSetup.detectServicesResult,
        configFileName
      );
      settings.framework = "services";
    } else if (rootInferredServicesChoice?.type === "services") {
      settings.framework = "services";
    } else {
      const skipSelectedRootInferredServicesPrompt = rootInferredServicesChoice?.type === "single-app";
      if (rootInferredServicesChoice?.type === "single-app") {
        rootDirectory = toProjectRootDirectory(
          path2,
          rootInferredServicesChoice.selectedPath
        );
      } else {
        rootDirectory = await inputRootDirectory(client, path2, autoConfirm);
        if (rootDirectory && !await validateRootDirectory(path2, join2(path2, rootDirectory))) {
          return {
            status: "error",
            exitCode: 1,
            reason: "INVALID_ROOT_DIRECTORY"
          };
        }
      }
      pathWithRootDirectory = rootDirectory ? join2(path2, rootDirectory) : path2;
      const selectedRootServicesSetup = pathWithRootDirectory === path2 ? null : await getServicesSetupState(pathWithRootDirectory);
      let selectedRootInferredServicesChoice = null;
      if (!skipSelectedRootInferredServicesPrompt) {
        selectedRootInferredServicesChoice = await promptForInferredServicesSetup({
          client,
          autoConfirm,
          nonInteractive,
          workPath: pathWithRootDirectory,
          inferred: selectedRootServicesSetup?.inferredServices ?? null,
          inferredWriteBlocker: selectedRootServicesSetup?.inferredServicesWriteBlocker ?? null
        });
      }
      if (selectedRootServicesSetup?.hasConfiguredServices) {
        displayConfiguredServicesSetup(
          selectedRootServicesSetup.detectServicesResult,
          configFileName
        );
        settings.framework = "services";
      } else if (selectedRootInferredServicesChoice?.type === "services") {
        settings.framework = "services";
      } else {
        if (selectedRootInferredServicesChoice?.type === "single-app") {
          rootDirectory = toProjectRootDirectory(
            path2,
            selectedRootInferredServicesChoice.selectedPath
          );
          pathWithRootDirectory = rootDirectory ? join2(path2, rootDirectory) : path2;
        }
        const localConfig = await readConfig(pathWithRootDirectory);
        if (localConfig instanceof CantParseJSONFile) {
          output_manager_default.prettyError(localConfig);
          return { status: "error", exitCode: 1 };
        }
        const isZeroConfig = !localConfig || !localConfig.builds || localConfig.builds.length === 0;
        if (isZeroConfig) {
          const localConfigurationOverrides = {
            buildCommand: localConfig?.buildCommand,
            devCommand: localConfig?.devCommand,
            framework: localConfig?.framework,
            commandForIgnoringBuildStep: localConfig?.ignoreCommand,
            installCommand: localConfig?.installCommand,
            outputDirectory: localConfig?.outputDirectory
          };
          const detectedProjectsForWorkspace = await detectProjects(
            pathWithRootDirectory
          );
          const detectedProjects = detectedProjectsForWorkspace.get("") || [];
          const framework = detectedProjects[0] ?? import_frameworks3.frameworkList.find((f) => f.slug === null);
          settings = await editProjectSettings(
            client,
            {},
            framework,
            autoConfirm,
            localConfigurationOverrides,
            configFileName
          );
        }
      }
    }
    let changeAdditionalSettings = false;
    if (!autoConfirm) {
      changeAdditionalSettings = await client.input.confirm(
        "Do you want to change additional project settings?",
        false
      );
    }
    let vercelAuthSetting = DEFAULT_VERCEL_AUTH_SETTING;
    if (changeAdditionalSettings) {
      vercelAuthSetting = await vercelAuth(client, {
        autoConfirm
      });
    }
    if (rootDirectory) {
      settings.rootDirectory = rootDirectory;
    }
    const project = await createProject(client, {
      ...settings,
      name: newProjectName,
      vercelAuth: vercelAuthSetting,
      v0
    });
    await linkFolderToProject(
      client,
      path2,
      {
        projectId: project.id,
        orgId: org.id
      },
      project.name,
      org.slug,
      successEmoji,
      autoConfirm,
      false
      // don't prompt to pull env for newly created projects
    );
    await connectGitRepository(client, path2, project, autoConfirm, org);
    return { status: "linked", org, project };
  } catch (err) {
    if (isAPIError(err) && err.code === "too_many_projects") {
      output_manager_default.prettyError(err);
      return { status: "error", exitCode: 1, reason: "TOO_MANY_PROJECTS" };
    }
    if (err instanceof Error && err.code === "HEADLESS") {
      return { status: "error", exitCode: 1, reason: "HEADLESS" };
    }
    printError(err);
    return { status: "error", exitCode: 1 };
  }
}
async function connectGitRepository(client, path2, project, autoConfirm, org) {
  try {
    const gitConfig = await parseGitConfig(join2(path2, ".git/config"));
    if (!gitConfig) {
      return;
    }
    const remoteUrls = pluckRemoteUrls(gitConfig);
    if (!remoteUrls || Object.keys(remoteUrls).length === 0) {
      return;
    }
    const shouldConnect = autoConfirm || await client.input.confirm(
      `Detected a repository. Connect it to this project?`,
      true
    );
    if (!shouldConnect) {
      return;
    }
    const repoInfo = await selectAndParseRemoteUrl(client, remoteUrls);
    if (!repoInfo) {
      return;
    }
    await checkExistsAndConnect({
      client,
      confirm: autoConfirm,
      gitProviderLink: project.link,
      org,
      gitOrg: repoInfo.org,
      project,
      // Type assertion since we only need the id
      provider: repoInfo.provider,
      repo: repoInfo.repo,
      repoPath: `${repoInfo.org}/${repoInfo.repo}`
    });
  } catch (error) {
    output_manager_default.debug(`Failed to connect git repository: ${error}`);
  }
}

export {
  validateRootDirectory,
  validatePaths,
  readConfig,
  displayDetectedServices,
  setupAndLink
};
