import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  formatOption,
  limitOption,
  nextOption
} from "./chunk-RFMC2QXQ.js";
import {
  packageName
} from "./chunk-ECRBC4HL.js";

// src/commands/activity/command.ts
var typesSubcommand = {
  name: "types",
  aliases: [],
  description: "List available event types with descriptions.",
  arguments: [],
  options: [formatOption],
  examples: [
    {
      name: "List all event types",
      value: `${packageName} activity types`
    },
    {
      name: "Output JSON",
      value: `${packageName} activity types --format json`
    }
  ]
};
var activityCommand = {
  name: "activity",
  aliases: [],
  description: "List user activity events.",
  arguments: [],
  subcommands: [
    // Hidden placeholder so the help synopsis renders [command] as optional
    // (help.ts treats `command` as required unless a subcommand has `default: true`)
    {
      name: "ls",
      aliases: ["list"],
      description: "",
      default: true,
      hidden: true,
      arguments: [],
      options: [],
      examples: []
    },
    typesSubcommand
  ],
  options: [
    {
      name: "type",
      shorthand: null,
      type: [String],
      argument: "TYPE",
      deprecated: false,
      description: "Filter by event type. Repeatable and comma-separated (e.g. --type deployment --type project-created or --type deployment,project-created)."
    },
    {
      name: "since",
      shorthand: null,
      type: String,
      argument: "DATE",
      deprecated: false,
      description: "Show events after this date (ISO 8601 or relative: 1d, 7d, 30d)."
    },
    {
      name: "until",
      shorthand: null,
      type: String,
      argument: "DATE",
      deprecated: false,
      description: "Show events before this date (ISO 8601 or relative)."
    },
    {
      name: "project",
      shorthand: "p",
      type: String,
      argument: "NAME_OR_ID",
      deprecated: false,
      description: "Filter by project (overrides auto-detected linked project)."
    },
    {
      name: "all",
      shorthand: "a",
      type: Boolean,
      deprecated: false,
      description: "Show all team events (ignore linked project auto-scoping)."
    },
    limitOption,
    nextOption,
    formatOption
  ],
  examples: [
    {
      name: "List events for the linked project",
      value: `${packageName} activity`
    },
    {
      name: "Filter events by multiple types",
      value: `${packageName} activity --type deployment --type project-created --since 7d`
    },
    {
      name: "Filter events by comma-separated types",
      value: `${packageName} activity --type deployment,project-created --since 7d`
    },
    {
      name: "List all team events",
      value: `${packageName} activity --all --since 30d`
    },
    {
      name: "Output JSON",
      value: `${packageName} activity --format json | jq '.events[]'`
    },
    {
      name: "List activity event types",
      value: `${packageName} activity types`
    }
  ]
};

export {
  typesSubcommand,
  activityCommand
};
