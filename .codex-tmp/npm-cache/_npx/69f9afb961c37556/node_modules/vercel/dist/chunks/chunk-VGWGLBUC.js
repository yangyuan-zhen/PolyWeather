import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  allOption,
  confirmOption,
  formatOption,
  nextOption,
  yesOption
} from "./chunk-RFMC2QXQ.js";
import {
  packageName
} from "./chunk-ECRBC4HL.js";

// src/commands/list/command.ts
var listCommand = {
  name: "list",
  aliases: ["ls"],
  description: "List deployments.",
  arguments: [
    {
      name: "app",
      required: false
    }
  ],
  options: [
    allOption,
    {
      name: "meta",
      description: "Filter deployments by metadata (e.g.: `-m KEY=value`). Can appear many times.",
      argument: "KEY=VALUE",
      shorthand: "m",
      type: [String],
      deprecated: false
    },
    {
      name: "policy",
      description: "See deployments with provided Deployment Retention policies (e.g.: `-p KEY=value`). Can appear many times.",
      argument: "KEY=VALUE",
      shorthand: "p",
      type: [String],
      deprecated: false
    },
    {
      name: "environment",
      description: "",
      argument: "TARGET",
      shorthand: null,
      type: String,
      deprecated: false
    },
    {
      name: "status",
      description: "Filter deployments by their status. Can be comma-separated for multiple statuses (e.g.: `--status BUILDING,READY`)",
      argument: "STATUS",
      shorthand: "s",
      type: String,
      deprecated: false
    },
    nextOption,
    // this can be deprecated someday
    { name: "prod", shorthand: null, type: Boolean, deprecated: false },
    yesOption,
    confirmOption,
    formatOption
  ],
  examples: [
    {
      name: "List all deployments for the currently linked project",
      value: `${packageName} list`
    },
    {
      name: "List all deployments across all projects",
      value: `${packageName} list --all`
    },
    {
      name: "List all deployments for the project `my-app`",
      value: `${packageName} list my-app`
    },
    {
      name: "Filter deployments by metadata",
      value: `${packageName} list -m key1=value1 -m key2=value2`
    },
    {
      name: "Paginate deployments for a project, where `1584722256178` is the time in milliseconds since the UNIX epoch",
      value: `${packageName} list my-app --next 1584722256178`
    },
    {
      name: "Filter deployments by status",
      value: `${packageName} list --status READY`
    },
    {
      name: "Filter deployments by multiple statuses",
      value: `${packageName} list --status BUILDING,ERROR`
    }
  ]
};

export {
  listCommand
};
