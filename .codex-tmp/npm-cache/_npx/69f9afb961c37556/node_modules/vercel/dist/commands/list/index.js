import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  isValidName
} from "../../chunks/chunk-Y4JJYHUG.js";
import {
  getCommandFlags
} from "../../chunks/chunk-EOZFDJSY.js";
import {
  parseMeta
} from "../../chunks/chunk-EKPSCRJZ.js";
import {
  getDeployment,
  toHost
} from "../../chunks/chunk-N45K6NXC.js";
import {
  getScope
} from "../../chunks/chunk-CUCRUPRY.js";
import {
  formatEnvironment,
  validateLsArgs
} from "../../chunks/chunk-45TDB64X.js";
import {
  validateJsonOutput
} from "../../chunks/chunk-XPKWKPWA.js";
import {
  listCommand
} from "../../chunks/chunk-VGWGLBUC.js";
import {
  help
} from "../../chunks/chunk-LDXYSGPZ.js";
import {
  table
} from "../../chunks/chunk-GE6G37P4.js";
import {
  formatProject,
  getLinkedProject,
  getProjectByNameOrId,
  parseTarget
} from "../../chunks/chunk-U7MQBM3F.js";
import {
  TelemetryClient
} from "../../chunks/chunk-U3WLEFHU.js";
import "../../chunks/chunk-XKHLPA6V.js";
import {
  elapsed,
  require_ms
} from "../../chunks/chunk-CO5D46AG.js";
import {
  getFlagsSpecification,
  parseArguments,
  printError
} from "../../chunks/chunk-RFMC2QXQ.js";
import {
  ProjectNotFound,
  getCommandName,
  require_lib
} from "../../chunks/chunk-ECRBC4HL.js";
import {
  output_manager_default,
  require_dist
} from "../../chunks/chunk-ZQKJVHXY.js";
import {
  require_source
} from "../../chunks/chunk-S7KYDPEM.js";
import {
  __toESM
} from "../../chunks/chunk-TZ2YI2VH.js";

// src/commands/list/index.ts
var import_ms = __toESM(require_ms(), 1);
var import_chalk = __toESM(require_source(), 1);
var import_title = __toESM(require_lib(), 1);

// src/util/parse-policy.ts
function parsePolicy(policy) {
  if (!policy) {
    return {};
  }
  if (typeof policy === "string") {
    policy = [policy];
  }
  const parsed = {};
  for (const item of policy) {
    const [key, ...rest] = item.split("=");
    parsed[key] = rest.join("=");
  }
  return parsed;
}

// src/commands/list/index.ts
var import_error_utils = __toESM(require_dist(), 1);

// src/util/telemetry/commands/list/index.ts
var ListTelemetryClient = class extends TelemetryClient {
  trackCliFlagAll(all) {
    if (all) {
      this.trackCliFlag("all");
    }
  }
  trackCliOptionMeta(meta) {
    if (meta && meta.length > 0) {
      this.trackCliOption({
        option: "meta",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionPolicy(policy) {
    if (policy && policy.length > 0) {
      this.trackCliOption({
        option: "policy",
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
  trackCliOptionNext(next) {
    if (next) {
      this.trackCliOption({
        option: "next",
        value: this.redactedValue
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
  trackCliFlagConfirm(flag) {
    if (flag) {
      this.trackCliFlag("confirm");
    }
  }
  trackCliOptionStatus(status) {
    if (status) {
      this.trackCliOption({
        option: "status",
        value: this.redactedValue
      });
    }
  }
  trackCliArgumentApp(app) {
    if (app) {
      this.trackCliArgument({
        arg: "app",
        value: this.redactedValue
      });
    }
  }
};

// src/commands/list/index.ts
function toDate(timestamp) {
  const date = new Date(timestamp);
  const options = {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  };
  return date.toLocaleDateString("en-US", options);
}
async function list(client) {
  const { print, log, warn, error, note, debug, spinner } = output_manager_default;
  let parsedArgs = null;
  const flagsSpecification = getFlagsSpecification(listCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (error2) {
    printError(error2);
    return 1;
  }
  const telemetry = new ListTelemetryClient({
    opts: {
      store: client.telemetryEventStore
    }
  });
  if (parsedArgs.flags["--help"]) {
    telemetry.trackCliFlagHelp("list");
    print(help(listCommand, { columns: client.stderr.columns }));
    return 0;
  }
  const validationResult = validateLsArgs({
    commandName: "ls [app]",
    args: parsedArgs.args,
    maxArgs: 2,
    exitCode: 2
  });
  if (validationResult !== 0) {
    return validationResult;
  }
  const formatResult = validateJsonOutput(parsedArgs.flags);
  if (!formatResult.valid) {
    error(formatResult.error);
    return 1;
  }
  const asJson = formatResult.jsonOutput;
  telemetry.trackCliFlagAll(parsedArgs.flags["--all"]);
  telemetry.trackCliFlagProd(parsedArgs.flags["--prod"]);
  telemetry.trackCliFlagYes(parsedArgs.flags["--yes"]);
  telemetry.trackCliOptionEnvironment(parsedArgs.flags["--environment"]);
  telemetry.trackCliOptionMeta(parsedArgs.flags["--meta"]);
  telemetry.trackCliOptionNext(parsedArgs.flags["--next"]);
  telemetry.trackCliOptionFormat(parsedArgs.flags["--format"]);
  telemetry.trackCliOptionPolicy(parsedArgs.flags["--policy"]);
  telemetry.trackCliOptionStatus(parsedArgs.flags["--status"]);
  if ("--confirm" in parsedArgs.flags) {
    telemetry.trackCliFlagConfirm(parsedArgs.flags["--confirm"]);
    warn("`--confirm` is deprecated, please use `--yes` instead");
    parsedArgs.flags["--yes"] = parsedArgs.flags["--confirm"];
  }
  const meta = parseMeta(parsedArgs.flags["--meta"]);
  const policy = parsePolicy(parsedArgs.flags["--policy"]);
  const target = parseTarget({
    flagName: "environment",
    flags: parsedArgs.flags
  });
  const statusFlag = parsedArgs.flags["--status"];
  let status;
  if (statusFlag) {
    const validStatuses = [
      "BUILDING",
      "ERROR",
      "INITIALIZING",
      "QUEUED",
      "READY",
      "CANCELED"
    ];
    const statusValues = statusFlag.split(",").map((s) => s.trim().toUpperCase());
    const invalidStatuses = statusValues.filter(
      (s) => !validStatuses.includes(s)
    );
    if (invalidStatuses.length > 0) {
      error(
        `Invalid status values: ${invalidStatuses.join(", ")}. Valid values are: ${validStatuses.join(", ")}`
      );
      return 1;
    }
    status = statusValues.join(",");
  }
  let project;
  let pagination;
  let contextName = "";
  let app = parsedArgs.args[1];
  const deployments = [];
  let singleDeployment = false;
  const allFlag = parsedArgs.flags["--all"];
  let showAllProjects = false;
  if (allFlag && app) {
    error("Cannot use --all flag with a project argument");
    return 1;
  }
  if (app) {
    if (!isValidName(app)) {
      error(`The provided argument "${app}" is not a valid project name`);
      return 1;
    }
    telemetry.trackCliArgumentApp(app);
    if (app.includes(".")) {
      try {
        ({ contextName } = await getScope(client));
      } catch (err) {
        if ((0, import_error_utils.isErrnoException)(err) && (err.code === "NOT_AUTHORIZED" || err.code === "TEAM_DELETED")) {
          error(err.message);
          return 1;
        }
      }
      if (!contextName) {
        error("No context name found");
        return 1;
      }
      const host = toHost(app);
      const deployment = await getDeployment(client, contextName, host);
      if (!deployment.projectId) {
        error(`Could not find a deployment for "${host}"`);
        return 1;
      }
      app = deployment.projectId;
      note(
        `We suggest using ${getCommandName(
          "inspect <deployment>"
        )} for retrieving details about a single deployment`
      );
      deployments.push(deployment);
      singleDeployment = true;
    }
    const p = await getProjectByNameOrId(client, app);
    if (p instanceof ProjectNotFound) {
      error(`The provided argument "${app}" is not a valid project name`);
      return 1;
    }
    project = p;
  } else if (allFlag) {
    showAllProjects = true;
  } else {
    const link = await getLinkedProject(client, client.cwd);
    if (link.status === "error") {
      return link.exitCode;
    }
    if (link.status === "linked") {
      project = link.project;
      client.config.currentTeam = link.org.id;
    } else {
      showAllProjects = true;
    }
  }
  if (!contextName) {
    try {
      ({ contextName } = await getScope(client));
    } catch (err) {
      if ((0, import_error_utils.isErrnoException)(err) && (err.code === "NOT_AUTHORIZED" || err.code === "TEAM_DELETED")) {
        error(err.message);
        return 1;
      }
    }
  }
  const nextTimestamp = parsedArgs.flags["--next"];
  if (Number.isNaN(nextTimestamp)) {
    error("Please provide a number for flag `--next`");
    return 1;
  }
  const projectSlugLink = project ? formatProject(contextName, project.name) : null;
  if (!singleDeployment) {
    if (!asJson) {
      spinner(`Fetching deployments in ${import_chalk.default.bold(contextName)}`);
    }
    const start = Date.now();
    debug("Fetching deployments");
    const query = new URLSearchParams({ limit: "20" });
    if (project) {
      query.set("projectId", project.id);
    }
    for (const [k, v] of Object.entries(meta)) {
      query.set(`meta-${k}`, v);
    }
    for (const [k, v] of Object.entries(policy)) {
      query.set(`policy-${k}`, v);
    }
    if (nextTimestamp) {
      query.set("until", String(nextTimestamp));
    }
    if (target) {
      query.set("target", target);
    }
    if (status) {
      query.set("state", status);
    }
    for await (const chunk of client.fetchPaginated(`/v6/deployments?${query}`)) {
      deployments.push(...chunk.deployments);
      pagination = chunk.pagination;
      if (deployments.length >= 20) {
        break;
      }
    }
    if (!deployments.length) {
      if (asJson) {
        const jsonOutput = { deployments: [], pagination, contextName };
        client.stdout.write(`${JSON.stringify(jsonOutput, null, 2)}
`);
      } else {
        log(`No deployments found under ${import_chalk.default.bold(contextName)}.`);
      }
      return 0;
    }
    if (!asJson) {
      const deploymentsLabel = target === "production" ? "Production deployments" : "Deployments";
      if (showAllProjects) {
        log(
          `${deploymentsLabel} under ${import_chalk.default.bold(contextName)} ${elapsed(Date.now() - start)}`
        );
      } else {
        log(
          `${deploymentsLabel} for ${projectSlugLink} ${elapsed(Date.now() - start)}`
        );
      }
    }
  }
  if (asJson) {
    const jsonOutput = {
      contextName,
      deployments: deployments.sort(sortByCreatedAt).map((dep) => ({
        id: dep.id,
        url: dep.url,
        name: dep.name,
        state: dep.readyState,
        target: dep.target,
        customEnvironment: dep.customEnvironment ? {
          id: dep.customEnvironment.id,
          slug: dep.customEnvironment.slug
        } : void 0,
        createdAt: dep.createdAt,
        buildingAt: dep.buildingAt,
        ready: dep.ready,
        creator: dep.creator ? {
          uid: dep.creator.uid,
          username: dep.creator.username
        } : void 0,
        meta: dep.meta
      })),
      pagination
    };
    client.stdout.write(`${JSON.stringify(jsonOutput, null, 2)}
`);
    return 0;
  }
  const headers = ["Age", "Project", "Deployment", "Status", "Environment"];
  const showPolicy = Object.keys(policy).length > 0;
  if (!showPolicy)
    headers.push("Duration", "Username");
  if (showPolicy)
    headers.push("Proposed Expiration");
  const urls = [];
  const tablePrint = table(
    [
      headers.map((header) => import_chalk.default.bold(import_chalk.default.cyan(header))),
      ...deployments.sort(sortByCreatedAt).map((dep) => {
        urls.push(`https://${dep.url}`);
        const proposedExp = dep.proposedExpiration ? toDate(Math.min(Date.now(), dep.proposedExpiration)) : "No expiration";
        const createdAt = (0, import_ms.default)(
          Date.now() - (dep?.undeletedAt ?? dep.createdAt)
        );
        const targetName = dep.customEnvironment?.slug || (dep.target === "production" ? "Production" : "Preview");
        const targetSlug = dep.customEnvironment?.id || dep.target || "preview";
        return [
          import_chalk.default.gray(createdAt),
          formatProject(contextName, dep.name),
          `https://${dep.url}`,
          stateString(dep.readyState || ""),
          formatEnvironment(contextName, dep.name, {
            id: targetSlug,
            slug: targetName
          }),
          ...!showPolicy ? [import_chalk.default.gray(getDeploymentDuration(dep))] : [],
          ...!showPolicy ? [import_chalk.default.gray(dep.creator?.username)] : [],
          ...showPolicy ? [import_chalk.default.gray(proposedExp)] : []
        ];
      }).filter(
        (app2) => (
          // if an app wasn't supplied to filter by,
          // we only want to render one deployment per app
          app2 === null ? filterUniqueApps() : () => true
        )
      )
    ],
    { hsep: 5 }
  ).replace(/^/gm, "  ");
  print(`
${tablePrint}

`);
  if (!client.stdout.isTTY) {
    client.stdout.write(urls.join("\n"));
    client.stdout.write("\n");
  }
  if (pagination?.next) {
    const flags = getCommandFlags(parsedArgs.flags, ["--next"]);
    log(
      `To display the next page, run ${getCommandName(
        `ls${app ? ` ${app}` : ""}${flags} --next ${pagination.next}`
      )}`
    );
  }
  return 0;
}
function getDeploymentDuration(dep) {
  if (!dep || !dep.ready || !dep.buildingAt) {
    return "?";
  }
  const duration = (0, import_ms.default)(dep.ready - dep.buildingAt);
  if (duration === "0ms") {
    return "--";
  }
  return duration;
}
function stateString(s) {
  const CIRCLE = "\u25CF ";
  const sTitle = (0, import_title.default)(s);
  switch (s) {
    case "INITIALIZING":
    case "BUILDING":
    case "DEPLOYING":
    case "ANALYZING":
      return import_chalk.default.yellow(CIRCLE) + sTitle;
    case "ERROR":
      return import_chalk.default.red(CIRCLE) + sTitle;
    case "READY":
      return import_chalk.default.green(CIRCLE) + sTitle;
    case "QUEUED":
      return import_chalk.default.white(CIRCLE) + sTitle;
    case "CANCELED":
      return import_chalk.default.gray(sTitle);
    default:
      return import_chalk.default.gray("UNKNOWN");
  }
}
function sortByCreatedAt(a, b) {
  return b.createdAt - a.createdAt;
}
function filterUniqueApps() {
  const uniqueApps = /* @__PURE__ */ new Set();
  return function uniqueAppFilter([appName]) {
    if (uniqueApps.has(appName)) {
      return false;
    }
    uniqueApps.add(appName);
    return true;
  };
}
export {
  list as default,
  getDeploymentDuration,
  stateString
};
