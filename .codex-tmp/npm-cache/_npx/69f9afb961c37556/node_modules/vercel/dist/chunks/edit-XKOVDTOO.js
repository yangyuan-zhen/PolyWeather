import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  editRoute
} from "./chunk-P3SKP5WM.js";
import {
  applyFlagMutations,
  cloneRoute,
  convertRouteToCurrentRoute,
  generateRoute,
  generatedRouteToAddInput,
  hasAnyTransformFlags,
  populateRouteEnv,
  printGeneratedRoutePreview,
  printRouteConfig,
  routingRuleToCurrentRoute,
  runInteractiveEditLoop
} from "./chunk-HRVQZZ3Q.js";
import {
  getRouteVersions
} from "./chunk-AHU7WNL2.js";
import {
  ensureProjectLink,
  getRoutes,
  offerAutoPromote,
  parseSubcommandArgs,
  resolveRoute,
  shellQuoteRouteIdentifierForSuggestion,
  withGlobalFlags
} from "./chunk-KM6BIRA3.js";
import {
  editSubcommand
} from "./chunk-CRZM5WM2.js";
import "./chunk-E3NE4SKN.js";
import "./chunk-U7MQBM3F.js";
import "./chunk-U3WLEFHU.js";
import {
  outputAgentError
} from "./chunk-XKHLPA6V.js";
import {
  stamp_default
} from "./chunk-CO5D46AG.js";
import "./chunk-RFMC2QXQ.js";
import {
  getCommandName
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

// src/commands/routes/edit.ts
var import_chalk = __toESM(require_source(), 1);
async function edit(client, argv) {
  const parsed = await parseSubcommandArgs(argv, editSubcommand, client);
  if (typeof parsed === "number")
    return parsed;
  const link = await ensureProjectLink(client);
  if (typeof link === "number")
    return link;
  const { project, org } = link;
  const teamId = org.type === "team" ? org.id : void 0;
  const { args, flags } = parsed;
  const skipConfirmation = flags["--yes"];
  const identifier = args[0];
  const { RoutesEditTelemetryClient } = await import("./routes-OFD6HJOW.js");
  const telemetry = new RoutesEditTelemetryClient({
    opts: { store: client.telemetryEventStore }
  });
  telemetry.trackCliArgumentNameOrId(identifier);
  telemetry.trackCliFlagYes(skipConfirmation);
  telemetry.trackCliOptionName(flags["--name"]);
  telemetry.trackCliOptionDescription(
    flags["--description"]
  );
  telemetry.trackCliOptionSrc(flags["--src"]);
  telemetry.trackCliOptionSrcSyntax(
    flags["--src-syntax"]
  );
  telemetry.trackCliOptionAction(flags["--action"]);
  telemetry.trackCliOptionDest(flags["--dest"]);
  telemetry.trackCliOptionStatus(flags["--status"]);
  telemetry.trackCliFlagNoDest(flags["--no-dest"]);
  telemetry.trackCliFlagNoStatus(flags["--no-status"]);
  telemetry.trackCliFlagClearConditions(
    flags["--clear-conditions"]
  );
  telemetry.trackCliFlagClearHeaders(
    flags["--clear-headers"]
  );
  telemetry.trackCliFlagClearTransforms(
    flags["--clear-transforms"]
  );
  telemetry.trackCliOptionSetResponseHeader(
    flags["--set-response-header"]
  );
  telemetry.trackCliOptionAppendResponseHeader(
    flags["--append-response-header"]
  );
  telemetry.trackCliOptionDeleteResponseHeader(
    flags["--delete-response-header"]
  );
  telemetry.trackCliOptionSetRequestHeader(
    flags["--set-request-header"]
  );
  telemetry.trackCliOptionAppendRequestHeader(
    flags["--append-request-header"]
  );
  telemetry.trackCliOptionDeleteRequestHeader(
    flags["--delete-request-header"]
  );
  telemetry.trackCliOptionSetRequestQuery(
    flags["--set-request-query"]
  );
  telemetry.trackCliOptionAppendRequestQuery(
    flags["--append-request-query"]
  );
  telemetry.trackCliOptionDeleteRequestQuery(
    flags["--delete-request-query"]
  );
  telemetry.trackCliOptionHas(flags["--has"]);
  telemetry.trackCliOptionMissing(flags["--missing"]);
  telemetry.trackCliOptionAi(flags["--ai"]);
  if (!identifier) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "missing_arguments",
          message: "Route name or ID is required as the first argument after routes edit.",
          next: [
            {
              command: withGlobalFlags(client, "routes edit <name-or-id>"),
              when: "replace <name-or-id> with route name or id from routes list"
            },
            {
              command: withGlobalFlags(client, "routes list"),
              when: "to list routes"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error(
      `Route name or ID is required. Usage: ${getCommandName("routes edit <name-or-id>")}`
    );
    return 1;
  }
  const { versions } = await getRouteVersions(client, project.id, { teamId });
  const existingStagingVersion = versions.find((v) => v.isStaging);
  output_manager_default.spinner("Fetching routes");
  const { routes } = await getRoutes(client, project.id, { teamId });
  output_manager_default.stopSpinner();
  if (routes.length === 0) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "not_found",
          message: "No routes found in this project.",
          next: [
            {
              command: withGlobalFlags(
                client,
                "routes add --ai <description> --yes"
              ),
              when: "add a route first (or use full flags)"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error("No routes found in this project.");
    return 1;
  }
  const originalRoute = await resolveRoute(client, routes, identifier);
  if (!originalRoute) {
    if (client.nonInteractive) {
      outputAgentError(
        client,
        {
          status: "error",
          reason: "not_found",
          message: `No route found matching "${identifier}".`,
          next: [
            {
              command: withGlobalFlags(client, "routes list"),
              when: "to list routes and pick an exact name or id"
            },
            {
              command: withGlobalFlags(client, "routes edit <name-or-id>"),
              when: "retry with a unique name or id"
            }
          ]
        },
        1
      );
    }
    output_manager_default.error(
      `No route found matching "${identifier}". Run ${import_chalk.default.cyan(
        getCommandName("routes list")
      )} to see all routes.`
    );
    return 1;
  }
  const aiPrompt = flags["--ai"];
  if (aiPrompt) {
    const conflictingFlags = [
      "--name",
      "--description",
      "--src",
      "--src-syntax",
      "--action",
      "--dest",
      "--status",
      "--no-dest",
      "--no-status",
      "--has",
      "--missing",
      "--set-response-header",
      "--append-response-header",
      "--delete-response-header",
      "--set-request-header",
      "--append-request-header",
      "--delete-request-header",
      "--set-request-query",
      "--append-request-query",
      "--delete-request-query",
      "--clear-conditions",
      "--clear-headers",
      "--clear-transforms"
    ];
    const usedConflicts = conflictingFlags.filter((f) => flags[f] !== void 0);
    if (usedConflicts.length > 0) {
      if (client.nonInteractive) {
        outputAgentError(
          client,
          {
            status: "error",
            reason: "invalid_arguments",
            message: `Cannot use --ai with ${usedConflicts.join(", ")}. Use --ai alone to describe changes.`,
            next: [
              {
                command: withGlobalFlags(
                  client,
                  `routes edit ${shellQuoteRouteIdentifierForSuggestion(identifier)} --ai <description> --yes`
                ),
                when: "use only --ai with route id/name already set"
              }
            ]
          },
          1
        );
      }
      output_manager_default.error(
        `Cannot use --ai with ${usedConflicts.join(", ")}. Use --ai alone to describe changes.`
      );
      return 1;
    }
    return await handleAIEdit(
      client,
      project.id,
      teamId,
      originalRoute,
      aiPrompt,
      skipConfirmation,
      existingStagingVersion
    );
  }
  const route = cloneRoute(originalRoute);
  const hasEditFlags = flags["--name"] !== void 0 || flags["--description"] !== void 0 || flags["--src"] !== void 0 || flags["--src-syntax"] !== void 0 || flags["--action"] !== void 0 || flags["--dest"] !== void 0 || flags["--status"] !== void 0 || flags["--no-dest"] !== void 0 || flags["--no-status"] !== void 0 || flags["--has"] !== void 0 || flags["--missing"] !== void 0 || flags["--clear-conditions"] !== void 0 || flags["--clear-headers"] !== void 0 || flags["--clear-transforms"] !== void 0 || hasAnyTransformFlags(flags);
  if (hasEditFlags) {
    const error = applyFlagMutations(route, flags);
    if (error) {
      if (client.nonInteractive) {
        outputAgentError(
          client,
          {
            status: "error",
            reason: "invalid_arguments",
            message: error,
            next: [
              {
                command: withGlobalFlags(
                  client,
                  `routes edit ${shellQuoteRouteIdentifierForSuggestion(identifier)} ...`
                ),
                when: "fix flags per message; see routes edit --help"
              }
            ]
          },
          1
        );
      }
      output_manager_default.error(error);
      return 1;
    }
  } else {
    if (!client.stdin.isTTY || client.nonInteractive) {
      if (client.nonInteractive) {
        outputAgentError(
          client,
          {
            status: "error",
            reason: "missing_arguments",
            message: "No edit flags provided. In non-interactive mode pass flags such as --name, --src, --dest, --action, header flags, or --ai <description> --yes.",
            next: [
              {
                command: withGlobalFlags(
                  client,
                  `routes edit ${shellQuoteRouteIdentifierForSuggestion(identifier)} --dest <dest> --yes`
                ),
                when: "example: set destination; see routes edit --help"
              }
            ],
            hint: "Run vercel routes edit --help for all flag options."
          },
          1
        );
      }
      output_manager_default.error(
        `No edit flags provided. When running non-interactively, use flags like --name, --dest, --src, etc. Run ${getCommandName("routes edit --help")} for all options.`
      );
      return 1;
    }
    output_manager_default.log(`
Editing route "${originalRoute.name}"`);
    printRouteConfig(route);
    const editMode = await client.input.select({
      message: "How would you like to edit this route?",
      choices: [
        { name: "Describe changes (AI-powered)", value: "ai" },
        { name: "Edit manually (field by field)", value: "manual" }
      ]
    });
    if (editMode === "ai") {
      telemetry.trackCliOptionAi("interactive");
      return await handleAIEdit(
        client,
        project.id,
        teamId,
        originalRoute,
        void 0,
        skipConfirmation,
        existingStagingVersion
      );
    }
    await runInteractiveEditLoop(client, route);
  }
  populateRouteEnv(route.route);
  if (JSON.stringify(route) === JSON.stringify(originalRoute)) {
    output_manager_default.log("No changes made.");
    return 0;
  }
  const editStamp = stamp_default();
  output_manager_default.spinner(`Updating route "${route.name}"`);
  try {
    const { version } = await editRoute(
      client,
      project.id,
      originalRoute.id,
      {
        route: {
          name: route.name,
          description: route.description,
          enabled: route.enabled,
          srcSyntax: route.srcSyntax,
          route: route.route
        }
      },
      { teamId }
    );
    output_manager_default.log(
      `${import_chalk.default.cyan("Updated")} route "${route.name}" ${import_chalk.default.gray(editStamp())}`
    );
    await offerAutoPromote(
      client,
      project.id,
      version,
      !!existingStagingVersion,
      { teamId, skipPrompts: skipConfirmation }
    );
    return 0;
  } catch (e) {
    const error = e;
    output_manager_default.error(error.message || "Failed to update route");
    return 1;
  }
}
async function handleAIEdit(client, projectId, teamId, originalRoute, aiPrompt, skipConfirmation, existingStagingVersion) {
  const currentRoute = routingRuleToCurrentRoute(originalRoute);
  let prompt = aiPrompt;
  let currentGenerated;
  for (; ; ) {
    if (!prompt) {
      prompt = await client.input.text({
        message: "Describe what you'd like to change:",
        validate: (val) => {
          if (!val)
            return "A description is required";
          if (val.length > 2e3)
            return "Description must be 2000 characters or less";
          return true;
        }
      });
    }
    output_manager_default.spinner("Generating updated route...");
    let errorMessage;
    try {
      const result = await generateRoute(
        client,
        projectId,
        { prompt, currentRoute },
        { teamId }
      );
      if (result.error) {
        errorMessage = result.error;
      } else if (!result.route) {
        errorMessage = "Could not apply changes. Try rephrasing.";
      } else {
        currentGenerated = result.route;
      }
    } catch (e) {
      const error = e;
      errorMessage = error.message || "Failed to generate updated route";
    }
    if (currentGenerated) {
      break;
    }
    output_manager_default.error(errorMessage);
    if (skipConfirmation || !client.stdin.isTTY) {
      return 1;
    }
    const retry = await client.input.select({
      message: "What would you like to do?",
      choices: [
        { name: "Try again with a different description", value: "retry" },
        { name: "Cancel", value: "cancel" }
      ]
    });
    if (retry === "cancel") {
      output_manager_default.log("No changes made.");
      return 0;
    }
    prompt = void 0;
  }
  printGeneratedRoutePreview(currentGenerated);
  if (skipConfirmation) {
    return await applyAIEdit(
      client,
      projectId,
      teamId,
      originalRoute,
      currentGenerated,
      existingStagingVersion,
      skipConfirmation
    );
  }
  if (!client.stdin.isTTY) {
    output_manager_default.error(
      `Cannot interactively confirm route changes in a non-TTY environment. Use ${getCommandName('routes edit <name-or-id> --ai "..." --yes')} to skip confirmation.`
    );
    return 1;
  }
  for (; ; ) {
    const choice = await client.input.select({
      message: "What would you like to do?",
      choices: [
        { name: "Confirm changes", value: "confirm" },
        { name: "Edit again with AI", value: "ai-edit" },
        { name: "Edit manually", value: "manual" },
        { name: "Discard", value: "discard" }
      ],
      pageSize: 4,
      loop: false
    });
    if (choice === "confirm") {
      return await applyAIEdit(
        client,
        projectId,
        teamId,
        originalRoute,
        currentGenerated,
        existingStagingVersion,
        skipConfirmation
      );
    }
    if (choice === "ai-edit") {
      const editPrompt = await client.input.text({
        message: "Describe what you'd like to change:",
        validate: (val) => {
          if (!val)
            return "A description is required";
          if (val.length > 2e3)
            return "Description must be 2000 characters or less";
          return true;
        }
      });
      output_manager_default.spinner("Updating route...");
      try {
        const editResult = await generateRoute(
          client,
          projectId,
          {
            prompt: editPrompt,
            currentRoute: convertRouteToCurrentRoute(currentGenerated)
          },
          { teamId }
        );
        if (editResult.error) {
          output_manager_default.error(editResult.error);
          output_manager_default.log("Keeping previous route:");
          printGeneratedRoutePreview(currentGenerated);
          continue;
        }
        if (!editResult.route) {
          output_manager_default.error("Could not apply changes. Try rephrasing.");
          output_manager_default.log("Keeping previous route:");
          printGeneratedRoutePreview(currentGenerated);
          continue;
        }
        currentGenerated = editResult.route;
        printGeneratedRoutePreview(currentGenerated);
      } catch (e) {
        const error = e;
        output_manager_default.error(error.message || "Failed to update route");
        output_manager_default.log("Keeping previous route:");
        printGeneratedRoutePreview(currentGenerated);
      }
      continue;
    }
    if (choice === "manual") {
      const routeInput = generatedRouteToAddInput(currentGenerated);
      const manualRoute = cloneRoute(originalRoute);
      manualRoute.name = routeInput.name;
      manualRoute.description = routeInput.description;
      manualRoute.srcSyntax = routeInput.srcSyntax;
      manualRoute.route = routeInput.route;
      await runInteractiveEditLoop(client, manualRoute);
      populateRouteEnv(manualRoute.route);
      const editStamp = stamp_default();
      output_manager_default.spinner(`Updating route "${manualRoute.name}"`);
      try {
        const { version } = await editRoute(
          client,
          projectId,
          originalRoute.id,
          {
            route: {
              name: manualRoute.name,
              description: manualRoute.description,
              enabled: manualRoute.enabled,
              srcSyntax: manualRoute.srcSyntax,
              route: manualRoute.route
            }
          },
          { teamId }
        );
        output_manager_default.log(
          `${import_chalk.default.cyan("Updated")} route "${manualRoute.name}" ${import_chalk.default.gray(editStamp())}`
        );
        await offerAutoPromote(
          client,
          projectId,
          version,
          !!existingStagingVersion,
          { teamId, skipPrompts: skipConfirmation }
        );
        return 0;
      } catch (e) {
        const error = e;
        output_manager_default.error(error.message || "Failed to update route");
        return 1;
      }
    }
    output_manager_default.log("No changes made.");
    return 0;
  }
}
async function applyAIEdit(client, projectId, teamId, originalRoute, generated, existingStagingVersion, skipConfirmation) {
  const routeInput = generatedRouteToAddInput(generated);
  populateRouteEnv(routeInput.route);
  const editStamp = stamp_default();
  output_manager_default.spinner(`Updating route "${routeInput.name}"`);
  try {
    const { version } = await editRoute(
      client,
      projectId,
      originalRoute.id,
      {
        route: {
          name: routeInput.name,
          description: routeInput.description,
          enabled: originalRoute.enabled,
          srcSyntax: routeInput.srcSyntax,
          route: routeInput.route
        }
      },
      { teamId }
    );
    output_manager_default.log(
      `${import_chalk.default.cyan("Updated")} route "${routeInput.name}" ${import_chalk.default.gray(editStamp())}`
    );
    await offerAutoPromote(
      client,
      projectId,
      version,
      !!existingStagingVersion,
      {
        teamId,
        skipPrompts: skipConfirmation
      }
    );
    return 0;
  } catch (e) {
    const error = e;
    output_manager_default.error(error.message || "Failed to update route");
    return 1;
  }
}
export {
  edit as default
};
