import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  LinkRequiredError,
  ProjectNotFound,
  isAPIError,
  packageName
} from "./chunk-ECRBC4HL.js";
import {
  require_dist
} from "./chunk-ZQKJVHXY.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/util/agent-output.ts
var import_error_utils = __toESM(require_dist(), 1);
function buildCommandWithYes(argv, pkgName = packageName) {
  const args = argv.slice(2);
  const hasYes = args.some((a) => a === "--yes" || a === "-y");
  const out = hasYes ? [...args] : [...args, "--yes"];
  return `${pkgName} ${out.join(" ")}`;
}
var GLOBAL_FLAG_NAMES = /* @__PURE__ */ new Set([
  "--cwd",
  "--config",
  "--yes",
  "-y",
  "--non-interactive",
  "--scope",
  "--team",
  "-S",
  "-T",
  "--token"
]);
var BOOLEAN_GLOBAL_FLAG_NAMES = /* @__PURE__ */ new Set(["--yes", "-y", "--non-interactive"]);
function getGlobalFlagsFromArgv(argv) {
  const args = argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.startsWith("--") ? arg.split("=")[0] : arg;
    if (GLOBAL_FLAG_NAMES.has(name)) {
      out.push(arg);
      const takesSeparateValue = !BOOLEAN_GLOBAL_FLAG_NAMES.has(name) && !arg.includes("=") && i + 1 < args.length && !args[i + 1].startsWith("-");
      if (takesSeparateValue) {
        out.push(args[i + 1]);
        i++;
      }
    }
  }
  return out;
}
function omitGlobalFlagsFromArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.startsWith("--") ? arg.split("=")[0] : arg;
    if (GLOBAL_FLAG_NAMES.has(name)) {
      const skipSeparateValue = !BOOLEAN_GLOBAL_FLAG_NAMES.has(name) && !arg.includes("=") && i + 1 < args.length && !args[i + 1].startsWith("-");
      if (skipSeparateValue) {
        i++;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}
function buildIntegrationCommandTailFromArgv(argv) {
  const args = argv.slice(2);
  const idx = args.indexOf("integration");
  if (idx === -1) {
    return "integration";
  }
  return omitGlobalFlagsFromArgs(args.slice(idx)).join(" ");
}
function buildCommandWithGlobalFlags(argv, commandTemplate, pkgName = packageName, options) {
  let preserved = getGlobalFlagsFromArgv(argv);
  if (options?.excludeFlags?.length) {
    const exclude = new Set(options.excludeFlags);
    const out = [];
    for (let i = 0; i < preserved.length; i++) {
      const arg = preserved[i];
      const name = arg.startsWith("--") ? arg.split("=")[0] : arg;
      if (exclude.has(name)) {
        if (!arg.includes("=") && i + 1 < preserved.length && !preserved[i + 1].startsWith("-")) {
          i++;
        }
        continue;
      }
      out.push(arg);
    }
    preserved = out;
  }
  const base = `${pkgName} ${commandTemplate}`;
  if (preserved.length === 0) {
    return base;
  }
  if (options?.prependGlobalFlags) {
    return `${pkgName} ${preserved.join(" ")} ${commandTemplate}`;
  }
  return `${base} ${preserved.join(" ")}`;
}
function getPreservedArgsForEnvAdd(argv) {
  const args = argv.slice(2);
  const addIdx = args.indexOf("add");
  if (addIdx === -1 || args[addIdx - 1] !== "env")
    return args;
  let i = addIdx + 1;
  let positionals = 0;
  while (i < args.length && positionals < 3 && !args[i].startsWith("-")) {
    positionals++;
    i++;
  }
  return args.slice(i);
}
function buildEnvAddCommandWithPreservedArgs(argv, commandTemplate, pkgName = packageName) {
  let preserved = getPreservedArgsForEnvAdd(argv);
  if (commandTemplate.includes("--yes")) {
    preserved = preserved.filter((a) => a !== "--yes" && a !== "-y");
  }
  if (commandTemplate.includes("--value")) {
    const out = [];
    for (let j = 0; j < preserved.length; j++) {
      if (preserved[j] === "--value" && j + 1 < preserved.length) {
        j++;
        continue;
      }
      if (preserved[j].startsWith("--value="))
        continue;
      out.push(preserved[j]);
    }
    preserved = out;
  }
  const base = `${pkgName} ${commandTemplate}`;
  if (preserved.length === 0)
    return base;
  return `${base} ${preserved.join(" ")}`;
}
function getPreservedArgsForEnvPull(argv) {
  const args = argv.slice(2);
  const pullIdx = args.indexOf("pull");
  if (pullIdx === -1 || args[pullIdx - 1] !== "env")
    return args;
  let i = pullIdx + 1;
  if (i < args.length && !args[i].startsWith("-"))
    i++;
  return args.slice(i);
}
function getPreservedArgsForEnvRm(argv) {
  const args = argv.slice(2);
  const rmIdx = args.indexOf("rm");
  if (rmIdx === -1 || args[rmIdx - 1] !== "env")
    return args;
  let i = rmIdx + 1;
  let positionals = 0;
  while (i < args.length && positionals < 3 && !args[i].startsWith("-")) {
    positionals++;
    i++;
  }
  return args.slice(i);
}
function buildEnvRmCommandWithPreservedArgs(argv, commandTemplate, pkgName = packageName) {
  let preserved = getPreservedArgsForEnvRm(argv);
  if (commandTemplate.includes("--yes")) {
    preserved = preserved.filter((a) => a !== "--yes" && a !== "-y");
  }
  const base = `${pkgName} ${commandTemplate}`;
  if (preserved.length === 0)
    return base;
  return `${base} ${preserved.join(" ")}`;
}
function getPreservedArgsForEnvUpdate(argv) {
  const args = argv.slice(2);
  const updateIdx = args.indexOf("update");
  if (updateIdx === -1 || args[updateIdx - 1] !== "env")
    return args;
  let i = updateIdx + 1;
  let positionals = 0;
  while (i < args.length && positionals < 3 && !args[i].startsWith("-")) {
    positionals++;
    i++;
  }
  return args.slice(i);
}
function buildEnvUpdateCommandWithPreservedArgs(argv, commandTemplate, pkgName = packageName) {
  let preserved = getPreservedArgsForEnvUpdate(argv);
  if (commandTemplate.includes("--yes")) {
    preserved = preserved.filter((a) => a !== "--yes" && a !== "-y");
  }
  if (commandTemplate.includes("--value")) {
    const out = [];
    for (let i = 0; i < preserved.length; i++) {
      if (preserved[i] === "--value" && i + 1 < preserved.length) {
        i++;
        continue;
      }
      if (preserved[i].startsWith("--value="))
        continue;
      out.push(preserved[i]);
    }
    preserved = out;
  }
  const base = `${pkgName} ${commandTemplate}`;
  if (preserved.length === 0)
    return base;
  return `${base} ${preserved.join(" ")}`;
}
function buildCommandWithScope(argv, scopeSlug, pkgName = packageName) {
  const args = argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope" || args[i] === "--team" || args[i] === "-S" || args[i] === "-T") {
      i++;
      continue;
    }
    if (args[i].startsWith("--scope=") || args[i].startsWith("--team=")) {
      continue;
    }
    out.push(args[i]);
  }
  out.push("--scope", scopeSlug);
  return `${pkgName} ${out.join(" ")}`;
}
function enrichActionRequiredWithInvokingCommand(payload, argv) {
  if (!payload.choices?.length) {
    return payload;
  }
  const next = [];
  const linkArgv = [...argv.slice(0, 2), "link", ...argv.slice(3)];
  for (const choice of payload.choices) {
    const slug = choice.name;
    next.push({
      command: buildCommandWithScope(linkArgv, slug),
      when: "Link first (then run any command without --scope)"
    });
    next.push({
      command: buildCommandWithScope(argv, slug),
      when: "Run this command with scope (no link)"
    });
  }
  return { ...payload, next };
}
function outputActionRequired(client, payload, exitCode = 1) {
  if (!shouldEmitNonInteractiveCommandError(client)) {
    return;
  }
  const enriched = enrichActionRequiredWithInvokingCommand(
    payload,
    client.argv
  );
  if (!enriched.hint && enriched.next?.length) {
    enriched.hint = "Run one of the commands in next[] to complete without prompting.";
  }
  client.stdout.write(`${JSON.stringify(enriched, null, 2)}
`);
  process.exit(exitCode);
}
function argvHasNonInteractive(argv) {
  if (!argv?.length) {
    return false;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--non-interactive") {
      return argv[i + 1] !== "false";
    }
    if (a.startsWith("--non-interactive=")) {
      return a.slice("--non-interactive=".length) !== "false";
    }
  }
  return false;
}
function shouldEmitNonInteractiveCommandError(client) {
  return client.nonInteractive || argvHasNonInteractive(client.argv ?? []);
}
function outputAgentError(client, payload, exitCode = 1) {
  if (!shouldEmitNonInteractiveCommandError(client)) {
    return;
  }
  client.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
  process.exit(exitCode);
}
function buildNextStepsForEdgeConfig(client) {
  return [
    {
      command: buildCommandWithGlobalFlags(client.argv, "edge-config list"),
      when: "List Edge Config stores in the current team scope"
    },
    {
      command: buildCommandWithGlobalFlags(client.argv, "teams switch"),
      when: "Switch to the team that owns the Edge Config"
    },
    {
      command: buildCommandWithGlobalFlags(client.argv, "whoami"),
      when: "Verify the current team or user scope"
    }
  ];
}
var EDGE_CONFIG_NON_INTERACTIVE_HINT = "Edge Config commands use your current team scope. Pass --scope or run `vercel teams switch` if the store is missing.";
function buildNextStepsForProjectSubcommands(client, variant) {
  const byName = variant === "access-groups" ? {
    template: "project access-groups <name>",
    when: "List access groups by project name (replace <name>)"
  } : variant === "access-summary" ? {
    template: "project access-summary <name>",
    when: "Show role counts by project name (replace <name>)"
  } : variant === "protection" ? {
    template: "project protection <name>",
    when: "Show deployment protection by project name (replace <name>)"
  } : variant === "speed-insights" ? {
    template: "project speed-insights <name>",
    when: "Enable Speed Insights by project name (replace <name>)"
  } : variant === "web-analytics" ? {
    template: "project web-analytics <name>",
    when: "Enable Web Analytics by project name (replace <name>)"
  } : variant === "checks" ? {
    template: "project checks add <name>",
    when: "Create a deployment check by project name (replace <name>)"
  } : {
    template: "project members <name>",
    when: "List members by project name (replace <name>)"
  };
  return [
    {
      command: buildCommandWithGlobalFlags(client.argv, "link"),
      when: "Re-link this directory to the correct Vercel project"
    },
    {
      command: buildCommandWithGlobalFlags(client.argv, byName.template),
      when: byName.when
    },
    {
      command: buildCommandWithGlobalFlags(client.argv, "project ls"),
      when: "List projects in the current team to pick a name"
    }
  ];
}
var PROJECT_SUBCOMMAND_ERROR_HINT = "If you use --cwd, ensure that folder is linked to the right project, or pass an explicit project name. Use --scope when the project belongs to another team.";
function resolveNonInteractiveDefaults(client, variant) {
  if (variant === "edge-config") {
    return {
      next: buildNextStepsForEdgeConfig(client),
      hint: EDGE_CONFIG_NON_INTERACTIVE_HINT
    };
  }
  return {
    next: buildNextStepsForProjectSubcommands(client, variant),
    hint: PROJECT_SUBCOMMAND_ERROR_HINT
  };
}
function writeAgentErrorPayloadAndExit(client, payload, exitCode, variant) {
  const defaults = resolveNonInteractiveDefaults(client, variant);
  const out = {
    ...payload,
    next: payload.next ?? defaults.next,
    hint: payload.hint ?? defaults.hint
  };
  client.stdout.write(`${JSON.stringify(out, null, 2)}
`);
  process.exit(exitCode);
}
function isProjectNotFoundLike(err) {
  if (err instanceof ProjectNotFound) {
    return true;
  }
  if ((0, import_error_utils.isError)(err) && "code" in err && err.code === "PROJECT_NOT_FOUND") {
    return true;
  }
  return false;
}
function isLinkRequiredLike(err) {
  return err instanceof LinkRequiredError;
}
function normalizeApiErrorText(message) {
  return message.replace(/\s*\(\d{3}\)\s*$/, "").trim();
}
function exitWithNonInteractiveError(client, err, exitCode = 1, options = {
  variant: "members"
}) {
  if (!shouldEmitNonInteractiveCommandError(client)) {
    return;
  }
  const { variant } = options;
  if (isLinkRequiredLike(err)) {
    if (variant === "edge-config") {
      writeAgentErrorPayloadAndExit(
        client,
        {
          status: "error",
          reason: "link_required",
          message: err instanceof Error ? err.message : String(err),
          next: buildNextStepsForEdgeConfig(client),
          hint: EDGE_CONFIG_NON_INTERACTIVE_HINT
        },
        exitCode,
        "edge-config"
      );
      return;
    }
    writeAgentErrorPayloadAndExit(
      client,
      {
        status: "error",
        reason: "link_required",
        message: err instanceof Error ? err.message : String(err)
      },
      exitCode,
      variant
    );
    return;
  }
  if (isProjectNotFoundLike(err)) {
    writeAgentErrorPayloadAndExit(
      client,
      {
        status: "error",
        reason: "project_not_found",
        message: err instanceof Error ? err.message : String(err)
      },
      exitCode,
      variant
    );
    return;
  }
  if (isAPIError(err)) {
    const rawMessage = err.serverMessage || err.message;
    const message = normalizeApiErrorText(rawMessage);
    const reason = err.status === 403 ? "forbidden" : err.status === 401 ? "not_authorized" : err.status === 404 ? variant === "edge-config" ? "not_found" : "project_not_found" : err.status === 429 ? "rate_limited" : "api_error";
    writeAgentErrorPayloadAndExit(
      client,
      {
        status: "error",
        reason,
        message,
        ...err.action && { action: err.action },
        ...err.resource && { resource: err.resource }
      },
      exitCode,
      variant
    );
  }
  writeAgentErrorPayloadAndExit(
    client,
    {
      status: "error",
      reason: "unexpected_error",
      message: err instanceof Error ? err.message : String(err)
    },
    exitCode,
    variant
  );
}
function openUrlInBrowserCommand(url) {
  if (process.platform === "win32")
    return `start ${url}`;
  if (process.platform === "darwin")
    return `open '${url}'`;
  return `xdg-open '${url}'`;
}

export {
  buildCommandWithYes,
  getGlobalFlagsFromArgv,
  buildIntegrationCommandTailFromArgv,
  buildCommandWithGlobalFlags,
  getPreservedArgsForEnvAdd,
  buildEnvAddCommandWithPreservedArgs,
  getPreservedArgsForEnvPull,
  getPreservedArgsForEnvRm,
  buildEnvRmCommandWithPreservedArgs,
  getPreservedArgsForEnvUpdate,
  buildEnvUpdateCommandWithPreservedArgs,
  outputActionRequired,
  argvHasNonInteractive,
  shouldEmitNonInteractiveCommandError,
  outputAgentError,
  exitWithNonInteractiveError,
  openUrlInBrowserCommand
};
