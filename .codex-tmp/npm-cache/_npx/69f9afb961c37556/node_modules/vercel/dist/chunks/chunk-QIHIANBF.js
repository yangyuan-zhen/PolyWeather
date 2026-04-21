import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/help.ts
var import_chalk = __toESM(require_source(), 1);
var packageName = "vercel";
var logo = "\u25B2";
var connexLine = process.env.FF_CONNEX_ENABLED ? "\n      connex               [cmd]       Manage Vercel Connect OAuth clients" : "";
var help = () => `
  ${import_chalk.default.bold(`${logo} ${packageName}`)} [options] <command | path>

  ${import_chalk.default.dim("For deploy command help, run `vercel deploy --help`")}

  ${import_chalk.default.dim("Commands:")}

    ${import_chalk.default.dim("Basic")}

      deploy               [path]      Performs a deployment ${import_chalk.default.bold(
  "(default)"
)}
      build                            Build the project locally into './vercel/output'
      cache                [cmd]       Manages cache for your current Project
      dev                              Start a local development server
      env                              Manages the Environment Variables for your current Project
      git                              Manage Git provider repository for your current Project
      help                 [cmd]       Displays complete help for [cmd]
      init                 [example]   Initialize an example project
      inspect              [id]        Displays information related to a deployment
      i | install          [name]      Install an integration from the Marketplace
      integration          [cmd]       Manages your Marketplace integrations
      ir | integration-resource [cmd]  Manages your Marketplace integration resources
      link                 [path]      Link local directory to a Vercel Project
      ls | list            [app]       Lists deployments
      login                [email]     Logs into your account or creates a new one
      logout                           Logs out of your account
      open                             Opens the current project in the Vercel Dashboard
      promote              [url|id]    Promote an existing deployment to current
      pull                 [path]      Pull your Project Settings from the cloud
      redeploy             [url|id]    Rebuild and deploy a previous deployment.
      rollback             [url|id]    Quickly revert back to a previous deployment
      switch               [scope]     Switches between different scopes

    ${import_chalk.default.dim("Advanced")}

      activity                         List user activity events
      agent                [init]      Generate AGENTS.md with Vercel best practices
      alerts                           List alerts for a project or team
      alias                [cmd]       Manages your domain aliases
      api                  [endpoint]  Make authenticated HTTP requests to the Vercel API [beta]
      bisect                           Use binary search to find the deployment that introduced a bug
      blob                 [cmd]       Manages your Blob stores and files
      buy                  [cmd]       Purchase Vercel products for your team
      certs                [cmd]       Manages your SSL certificates${connexLine}
      contract                         Show contract information for billing periods
      cron | crons         [cmd]       Manage cron jobs for a project [beta]
      curl                 [path]      cURL requests to your linked project's deployment [beta]
      deploy-hooks         [cmd]       Manage deploy hooks for Git-triggered builds
      dns                  [name]      Manages your DNS records
      domains              [name]      Manages your domain names
      httpstat             path        Visualize HTTP timing statistics for deployments
      logs                 [url]       Displays the logs for a deployment
      metrics              <metric>    Queries observability metrics for your project or team
      mcp                              Set up MCP agents and configuration
      microfrontends                   Manages your microfrontends
      projects                         Manages your Projects
      redirects            [cmd]       Manages redirects for your current Project
      rm | remove          [id]        Removes a deployment
      routes               [cmd]       Manages routing rules for your current Project
      rr | rolling-release [cmd]       Manage rolling releases for gradual traffic shifting
      skills               [query]     Discover agent skills relevant to your project
      target               [cmd]       Manage custom environments for your Project
      teams                            Manages your teams
      telemetry            [cmd]       Enable or disable telemetry collection
      upgrade                          Upgrade the Vercel CLI to the latest version
      usage                            Show billing usage for the current billing period
      webhooks             [cmd]       Manages webhooks [beta]
      whoami                           Shows the username of the currently logged in user

  ${import_chalk.default.dim("Global Options:")}

    -h, --help                     Output usage information
    -v, --version                  Output the version number
    --cwd                          Current working directory
    -A ${import_chalk.default.bold.underline("FILE")}, --local-config=${import_chalk.default.bold.underline(
  "FILE"
)}   Path to the local ${"`vercel.json`"} file
    -Q ${import_chalk.default.bold.underline("DIR")}, --global-config=${import_chalk.default.bold.underline(
  "DIR"
)}    Path to the global ${"`.vercel`"} directory
    -d, --debug                    Debug mode [off]
    --no-color                     No color mode [off]
    --non-interactive              Run without interactive prompts (default when agent detected)
    -S, --scope                    Set a custom scope
    -t ${import_chalk.default.underline("TOKEN")}, --token=${import_chalk.default.underline(
  "TOKEN"
)}        Login token

  ${import_chalk.default.dim("Examples:")}

  ${import_chalk.default.gray("\u2013")} Deploy the current directory

    ${import_chalk.default.cyan(`$ ${packageName}`)}

  ${import_chalk.default.gray("\u2013")} Deploy a custom path

    ${import_chalk.default.cyan(`$ ${packageName} /usr/src/project`)}

  ${import_chalk.default.gray("\u2013")} Deploy with Environment Variables

    ${import_chalk.default.cyan(`$ ${packageName} -e NODE_ENV=production`)}

  ${import_chalk.default.gray("\u2013")} Show the usage information for the sub command ${import_chalk.default.dim(
  "`list`"
)}

    ${import_chalk.default.cyan(`$ ${packageName} help list`)}
`;

export {
  help
};
