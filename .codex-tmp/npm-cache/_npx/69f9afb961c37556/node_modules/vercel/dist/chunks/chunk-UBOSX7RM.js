import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  AGENT_ACTION
} from "./chunk-E3NE4SKN.js";
import {
  getEnvTargetPlaceholder,
  global_path_default
} from "./chunk-U7MQBM3F.js";
import {
  yesOption
} from "./chunk-RFMC2QXQ.js";
import {
  packageName
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

// src/commands/build/command.ts
var buildCommand = {
  name: "build",
  aliases: [],
  description: "Build the project.",
  arguments: [],
  options: [
    {
      name: "prod",
      description: "Build a production deployment",
      shorthand: null,
      type: Boolean,
      deprecated: false
    },
    {
      name: "target",
      shorthand: null,
      type: String,
      argument: "TARGET",
      deprecated: false,
      description: "Specify the target environment"
    },
    {
      name: "output",
      description: "Directory where built assets will be written to",
      shorthand: null,
      argument: "DIR",
      type: String,
      deprecated: false
    },
    {
      ...yesOption,
      description: "Skip the confirmation prompt about pulling environment variables and project settings when not found locally"
    },
    {
      name: "standalone",
      description: "Create a standalone build with all dependencies inlined into function output folders",
      shorthand: null,
      type: Boolean,
      deprecated: false
    },
    {
      name: "id",
      description: "Deployment ID to pull environment variables from (e.g. dpl_xxx)",
      shorthand: null,
      type: String,
      argument: "ID",
      deprecated: false
    }
  ],
  examples: [
    {
      name: "Build the project",
      value: `${packageName} build`
    },
    {
      name: "Build the project in a specific directory",
      value: `${packageName} build --cwd ./path-to-project`
    },
    {
      name: "Build with deployment-scoped environment variables",
      value: `${packageName} build --id dpl_xxx`
    }
  ]
};

// src/util/agent/auto-install-agentic.ts
var import_chalk = __toESM(require_source(), 1);
import { readFile, writeFile } from "fs/promises";
import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { KNOWN_AGENTS } from "@vercel/detect-agent";
var PREFS_FILE = "agent-preferences.json";
var CLAUDE_LEGACY_PLUGIN_ID = "vercel-plugin@vercel";
var CLAUDE_OFFICIAL_PLUGIN_ID = "vercel@claude-plugins-official";
var VERCEL_PLUGIN_VERSION_URL = "https://raw.githubusercontent.com/vercel/vercel-plugin/main/.claude-plugin/plugin.json";
var AGENT_TO_TARGET = {
  [KNOWN_AGENTS.CLAUDE]: "claude-code",
  [KNOWN_AGENTS.COWORK]: "claude-code"
};
function getPluginTargetForAgent(agentName) {
  if (!agentName) {
    return void 0;
  }
  return AGENT_TO_TARGET[agentName];
}
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function readPrefs() {
  try {
    const raw = await readFile(
      join(global_path_default(), PREFS_FILE),
      "utf-8"
    );
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function writePrefs(prefs) {
  try {
    const normalizedPrefs = {};
    if (prefs.pluginDeclined) {
      normalizedPrefs.pluginDeclined = true;
    }
    if (prefs.lastPromptedAt) {
      normalizedPrefs.lastPromptedAt = prefs.lastPromptedAt;
    }
    await writeFile(
      join(global_path_default(), PREFS_FILE),
      JSON.stringify(normalizedPrefs, null, 2),
      "utf-8"
    );
  } catch {
  }
}
async function getPluginTargets(agentName) {
  const targetForAgent = getPluginTargetForAgent(agentName);
  if (targetForAgent) {
    return [targetForAgent];
  }
  if (agentName) {
    return [];
  }
  const home = homedir();
  const targets = [];
  if (await fileExists(join(home, ".claude"))) {
    targets.push("claude-code");
  }
  return targets;
}
async function readClaudeInstalledPluginsFromRegistry() {
  try {
    const raw = await readFile(
      join(homedir(), ".claude", "plugins", "installed_plugins.json"),
      "utf-8"
    );
    const data = JSON.parse(raw);
    const plugins = data?.plugins ?? {};
    const entries = [];
    for (const [id, installs] of Object.entries(plugins)) {
      if (!Array.isArray(installs))
        continue;
      for (const install of installs) {
        if (!install || typeof install !== "object")
          continue;
        entries.push({
          id,
          ...install,
          enabled: true
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}
async function isPluginInstalledForTarget(target) {
  if (target === "claude-code") {
    const status = await getClaudePluginStatus();
    return status.state === "official-only";
  }
  return false;
}
async function confirm(client, message) {
  if (!client.stdin.isTTY) {
    return false;
  }
  return client.input.confirm(message, true);
}
function getTodayKey() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function wasPromptedToday(prefs) {
  return prefs.lastPromptedAt === getTodayKey();
}
async function markPromptedToday(prefs) {
  prefs.lastPromptedAt = getTodayKey();
  await writePrefs(prefs);
}
async function runCommand(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${String(err)}` });
    });
  });
}
async function getClaudeInstalledPlugins() {
  const result = await runCommand("claude", ["plugins", "list", "--json"]);
  if (result.exitCode === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      output_manager_default.debug(`Failed to parse Claude plugin list JSON: ${err}`);
    }
  } else if (result.stderr.trim().length > 0) {
    output_manager_default.debug(
      `Failed to run 'claude plugins list --json': ${result.stderr}`
    );
  }
  return readClaudeInstalledPluginsFromRegistry();
}
async function fetchLatestVercelPluginVersion() {
  try {
    const response = await fetch(VERCEL_PLUGIN_VERSION_URL);
    if (!response.ok) {
      output_manager_default.debug(
        `Failed to fetch latest Vercel plugin version: ${response.status}`
      );
      return void 0;
    }
    const manifest = await response.json();
    return typeof manifest.version === "string" ? manifest.version : void 0;
  } catch (err) {
    output_manager_default.debug(`Failed to fetch latest Vercel plugin version: ${err}`);
    return void 0;
  }
}
function comparePluginVersions(a, b) {
  if (!a && !b)
    return 0;
  if (!a)
    return -1;
  if (!b)
    return 1;
  const parse = (value) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r)
      return 1;
    if (l < r)
      return -1;
  }
  return 0;
}
function buildClaudePluginStatus(installedPlugins, latestVersion) {
  const legacy = installedPlugins.find(
    (plugin) => plugin.id === CLAUDE_LEGACY_PLUGIN_ID
  );
  const official = installedPlugins.find(
    (plugin) => plugin.id === CLAUDE_OFFICIAL_PLUGIN_ID
  );
  let state = "none";
  if (legacy && official)
    state = "both";
  else if (legacy)
    state = "legacy-only";
  else if (official)
    state = "official-only";
  return {
    state,
    legacy,
    official,
    latestVersion
  };
}
function buildClaudePluginMigrationPlan(status) {
  const plan = {
    installOfficial: false,
    updateOfficial: false,
    removeLegacy: false,
    removeLegacyMarketplace: false
  };
  switch (status.state) {
    case "none":
      plan.installOfficial = true;
      break;
    case "legacy-only":
      plan.installOfficial = true;
      plan.removeLegacy = true;
      plan.removeLegacyMarketplace = true;
      break;
    case "both":
      plan.removeLegacy = true;
      plan.removeLegacyMarketplace = true;
      break;
    case "official-only":
      break;
  }
  if (status.official?.version && status.latestVersion && comparePluginVersions(status.official.version, status.latestVersion) < 0) {
    plan.updateOfficial = true;
  }
  return plan;
}
function hasClaudeMigrationActions(plan) {
  return plan.installOfficial || plan.updateOfficial || plan.removeLegacy || plan.removeLegacyMarketplace;
}
function buildClaudePromptCopy(status, plan) {
  if (plan.installOfficial && status.state === "none") {
    return {
      message: "",
      confirm: "Working with Vercel is easier with the Vercel Plugin for Claude Code. Would you like to install it?"
    };
  }
  if (plan.installOfficial && status.state === "legacy-only") {
    return {
      message: "",
      confirm: "Working with Vercel is easier with the latest Vercel Plugin for Claude Code. Would you like to update it?"
    };
  }
  if (status.state === "both" && plan.removeLegacy) {
    return {
      message: "",
      confirm: "Working with Vercel is easier with the latest Vercel Plugin for Claude Code. Would you like to update it?"
    };
  }
  if (plan.updateOfficial) {
    const fromVersion = status.official?.version ?? "your current version";
    const toVersion = status.latestVersion ?? "the latest version";
    return {
      message: "",
      confirm: `Working with Vercel is easier with the latest Vercel Plugin for Claude Code. Would you like to update from ${fromVersion} to ${toVersion}?`
    };
  }
  return {
    message: "The Vercel plugin needs attention in Claude Code before your agent harness is fully up to date.",
    confirm: "Apply the Vercel plugin changes for Claude Code?"
  };
}
function buildClaudeActionRequiredMessage(status, plan) {
  if (status.state === "legacy-only") {
    return `Working with Vercel is easier with the latest Vercel Plugin for Claude Code. It will run:
1. claude plugins install ${CLAUDE_OFFICIAL_PLUGIN_ID}
2. claude plugins uninstall ${CLAUDE_LEGACY_PLUGIN_ID}
Would you like me to update it?`;
  }
  if (status.state === "both" || plan.removeLegacy) {
    return `Working with Vercel is easier with the latest Vercel Plugin for Claude Code. It will run:
1. claude plugins uninstall ${CLAUDE_LEGACY_PLUGIN_ID}
Would you like me to update it?`;
  }
  if (plan.updateOfficial) {
    return `Working with Vercel is easier with the latest Vercel Plugin for Claude Code. It will run:
1. claude plugins update ${CLAUDE_OFFICIAL_PLUGIN_ID}
Would you like me to update it?`;
  }
  return `Working with Vercel is easier with the Vercel Plugin for Claude Code. It will run:
1. claude plugins install ${CLAUDE_OFFICIAL_PLUGIN_ID}
Would you like me to install it?`;
}
function buildClaudeActionRequiredLabel(status, plan) {
  if (status.state === "legacy-only" || status.state === "both" || plan.removeLegacy || plan.updateOfficial) {
    return "Update it";
  }
  return "Install it";
}
function getClaudeActionRequiredCommand(status, plan) {
  if (plan.installOfficial && status.state === "none") {
    return `claude plugins install ${CLAUDE_OFFICIAL_PLUGIN_ID}`;
  }
  if (status.state === "both" && plan.removeLegacy) {
    return `claude plugins uninstall ${CLAUDE_LEGACY_PLUGIN_ID}`;
  }
  if (plan.updateOfficial && status.state === "official-only") {
    return `claude plugins update ${CLAUDE_OFFICIAL_PLUGIN_ID}`;
  }
  return `claude plugins install ${CLAUDE_OFFICIAL_PLUGIN_ID}`;
}
function getClaudeActionRequiredNextSteps(status, plan) {
  const next = [
    {
      command: getClaudeActionRequiredCommand(status, plan),
      when: buildClaudeActionRequiredLabel(status, plan)
    }
  ];
  if (status.state === "legacy-only" && plan.removeLegacy) {
    next.push({
      command: `claude plugins uninstall ${CLAUDE_LEGACY_PLUGIN_ID}`,
      when: "Remove the old plugin after the update"
    });
  }
  return next;
}
async function runClaudeCommand(spinnerMessage, successMessage, failureMessage, args, options) {
  output_manager_default.spinner(spinnerMessage);
  const result = await runCommand("claude", args);
  output_manager_default.stopSpinner();
  if (result.exitCode === 0) {
    if (!options?.quietSuccess) {
      output_manager_default.success(successMessage);
    }
    return true;
  }
  output_manager_default.warn(failureMessage);
  output_manager_default.debug(
    `Claude command failed: claude ${args.join(" ")}
${result.stderr || result.stdout}`
  );
  return false;
}
async function runClaudeMigration(plan) {
  if (plan.installOfficial) {
    const installed = await runClaudeCommand(
      "Installing the official Vercel Claude plugin...",
      "Updated the Vercel plugin",
      "Failed to install the official Vercel Claude plugin.",
      ["plugins", "install", CLAUDE_OFFICIAL_PLUGIN_ID]
    );
    if (!installed) {
      return;
    }
  } else if (plan.updateOfficial) {
    await runClaudeCommand(
      "Updating the official Vercel Claude plugin...",
      "Updated the Vercel plugin",
      "Failed to update the official Vercel Claude plugin.",
      ["plugins", "update", CLAUDE_OFFICIAL_PLUGIN_ID]
    );
  }
  const statusAfterInstall = await getClaudePluginStatus();
  if (!statusAfterInstall.official) {
    output_manager_default.warn(
      "Skipping Claude cleanup because the official Vercel plugin is not installed."
    );
    return;
  }
  if (plan.removeLegacy && statusAfterInstall.legacy) {
    const removedLegacy = await runClaudeCommand(
      "Removing the legacy Vercel Claude plugin...",
      "Removed the legacy Vercel Claude plugin",
      "Installed the official Vercel Claude plugin, but could not remove the legacy install.",
      ["plugins", "uninstall", CLAUDE_LEGACY_PLUGIN_ID],
      { quietSuccess: true }
    );
    if (!removedLegacy) {
      output_manager_default.log(
        `Cleanup command: claude plugins uninstall ${CLAUDE_LEGACY_PLUGIN_ID}`
      );
      return;
    }
  }
  if (plan.removeLegacyMarketplace) {
    const finalStatus = await getClaudePluginStatus();
    if (!finalStatus.legacy) {
      const removedMarketplace = await runClaudeCommand(
        "Removing the legacy Vercel marketplace...",
        "Removed the legacy Vercel marketplace",
        "Removed the legacy Vercel plugin, but could not remove the legacy marketplace.",
        ["plugins", "marketplace", "remove", "vercel"],
        { quietSuccess: true }
      );
      if (!removedMarketplace) {
        output_manager_default.log("Cleanup command: claude plugins marketplace remove vercel");
      }
    }
  }
}
async function getClaudePluginStatus() {
  const [installedPlugins, latestVersion] = await Promise.all([
    getClaudeInstalledPlugins(),
    fetchLatestVercelPluginVersion()
  ]);
  return buildClaudePluginStatus(installedPlugins, latestVersion);
}
async function applyPluginActions(targets, claudePlan) {
  for (const target of targets) {
    if (target === "claude-code" && claudePlan) {
      await runClaudeMigration(claudePlan);
    } else {
      output_manager_default.debug(`Skipping unsupported plugin target: ${target}`);
    }
  }
}
async function autoInstallVercelPlugin(client, options) {
  try {
    const prefs = await readPrefs();
    const applyMode = options?.mode === "apply";
    if (!prefs.pluginDeclined || applyMode) {
      const targets = await getPluginTargets(client.agentName);
      const uninstalledTargets = [];
      const claudeStatus = targets.includes("claude-code") ? await getClaudePluginStatus() : void 0;
      const claudePlan = claudeStatus ? buildClaudePluginMigrationPlan(claudeStatus) : void 0;
      for (const target of targets) {
        if (target === "claude-code") {
          if (claudePlan && hasClaudeMigrationActions(claudePlan)) {
            uninstalledTargets.push(target);
          }
          continue;
        }
        if (!await isPluginInstalledForTarget(target)) {
          uninstalledTargets.push(target);
        }
      }
      if (uninstalledTargets.length > 0) {
        if (!applyMode && wasPromptedToday(prefs)) {
          return;
        }
        if (applyMode) {
          prefs.pluginDeclined = false;
          await writePrefs(prefs);
          await applyPluginActions(uninstalledTargets, claudePlan);
          return;
        }
        const promptMessages = [];
        let confirmMessage = "Install the Vercel plugin?";
        if (uninstalledTargets.includes("claude-code") && claudeStatus && claudePlan) {
          const claudePrompt = buildClaudePromptCopy(claudeStatus, claudePlan);
          promptMessages.push(claudePrompt.message);
          confirmMessage = claudePrompt.confirm;
        }
        if (client.isAgent && !client.stdin.isTTY) {
          const actionRequiredMessage = uninstalledTargets.includes("claude-code") && claudeStatus && claudePlan ? buildClaudeActionRequiredMessage(claudeStatus, claudePlan) : promptMessages.join(" ");
          const next = uninstalledTargets.includes("claude-code") && claudeStatus && claudePlan ? getClaudeActionRequiredNextSteps(claudeStatus, claudePlan) : [
            {
              command: `claude plugins install ${CLAUDE_OFFICIAL_PLUGIN_ID}`,
              when: "Install it"
            }
          ];
          client.stdout.write(
            `${JSON.stringify(
              {
                status: "action_required",
                reason: "plugin_install",
                action: AGENT_ACTION.CONFIRMATION_REQUIRED,
                message: actionRequiredMessage,
                userActionRequired: true,
                next
              },
              null,
              2
            )}
`
          );
          await markPromptedToday(prefs);
          return;
        }
        const promptMessage = promptMessages.join(" ").trim();
        if (promptMessage) {
          output_manager_default.log(promptMessage);
        }
        const accepted = await confirm(client, confirmMessage);
        await markPromptedToday(prefs);
        if (accepted) {
          prefs.pluginDeclined = false;
          await writePrefs(prefs);
          await applyPluginActions(uninstalledTargets, claudePlan);
        } else {
          prefs.pluginDeclined = true;
          await writePrefs(prefs);
        }
      }
    }
  } catch (err) {
    output_manager_default.debug(`Auto-install agent tooling failed: ${err}`);
  }
}
async function showPluginTipIfNeeded() {
  try {
    const prefs = await readPrefs();
    if (prefs.pluginDeclined)
      return;
    const targets = await getPluginTargets();
    for (const target of targets) {
      if (!await isPluginInstalledForTarget(target)) {
        output_manager_default.log(
          import_chalk.default.dim(
            "Tip: Run `npx plugins add vercel/vercel-plugin` to enhance your agent experience"
          )
        );
        return;
      }
    }
  } catch {
  }
}

// src/commands/pull/command.ts
var pullCommand = {
  name: "pull",
  aliases: [],
  description: "Pull latest environment variables and project settings from Vercel. ",
  arguments: [
    {
      name: "project-path",
      required: false
    }
  ],
  options: [
    {
      name: "environment",
      description: "Deployment environment [development]",
      argument: "TARGET",
      shorthand: null,
      type: String,
      deprecated: false
    },
    {
      name: "git-branch",
      description: "Specify the Git branch to pull specific Environment Variables for",
      argument: "NAME",
      shorthand: null,
      type: String,
      deprecated: false
    },
    {
      name: "prod",
      shorthand: null,
      type: Boolean,
      deprecated: false
    },
    {
      ...yesOption,
      description: "Skip questions when setting up new project using default scope and settings"
    }
  ],
  examples: [
    {
      name: "Pull the latest Environment Variables and Project Settings from the cloud",
      value: `${packageName} pull`
    },
    {
      name: "Pull the latest Environment Variables and Project Settings from the cloud targeting a directory",
      value: `${packageName} pull ./path-to-project`
    },
    {
      name: "Pull for a specific environment",
      value: `${packageName} pull --environment=${getEnvTargetPlaceholder()}`
    },
    {
      name: "Pull for a preview feature branch",
      value: `${packageName} pull --environment=preview --git-branch=feature-branch`
    },
    {
      name: "If you want to download environment variables to a specific file, use `vercel env pull` instead",
      value: `${packageName} env pull`
    }
  ]
};

export {
  buildCommand,
  pullCommand,
  autoInstallVercelPlugin,
  showPluginTipIfNeeded
};
