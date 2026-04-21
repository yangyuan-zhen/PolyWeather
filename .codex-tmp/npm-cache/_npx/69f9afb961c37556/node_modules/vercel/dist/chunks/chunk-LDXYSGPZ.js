import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  noBorderChars,
  require_cli_table3
} from "./chunk-GE6G37P4.js";
import {
  require_dist
} from "./chunk-U3WLEFHU.js";
import {
  globalCommandOptions
} from "./chunk-RFMC2QXQ.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __toESM
} from "./chunk-TZ2YI2VH.js";

// src/commands/help.ts
var import_chalk = __toESM(require_source(), 1);
var import_constants = __toESM(require_dist(), 1);
var import_cli_table3 = __toESM(require_cli_table3(), 1);
var INDENT = " ".repeat(2);
var NEWLINE = "\n";
var tableOptions = {
  chars: noBorderChars,
  style: {
    "padding-left": 0,
    "padding-right": 0
  }
};
function wordWrap(text, maxWidth) {
  const _tableOptions = Object.assign({}, tableOptions, {
    colWidths: [maxWidth],
    style: {
      "padding-left": INDENT.length
    }
  });
  const table = new import_cli_table3.default(_tableOptions);
  table.push([
    {
      content: text,
      wordWrap: true
    }
  ]);
  return table.toString();
}
function lineToString(line) {
  let string = "";
  for (let i = 0; i < line.length; i++) {
    if (i === line.length - 1) {
      string += line[i];
    } else {
      const curr = line[i];
      const next = line[i + 1];
      string += curr;
      if (curr.trim() !== "" && next.trim() !== "") {
        string += " ";
      }
    }
  }
  return string;
}
function outputArrayToString(outputArray) {
  return outputArray.filter((line) => line !== null).join(NEWLINE);
}
function buildCommandSynopsisLine(command, parent) {
  const line = [INDENT, import_constants.LOGO, import_chalk.default.bold(import_constants.NAME)];
  if (parent) {
    line.push(import_chalk.default.bold(parent.name));
  }
  line.push(import_chalk.default.bold(command.name));
  const args = command.arguments.slice(0);
  if (args.length === 0 && command.subcommands && command.subcommands.length > 0) {
    args.push({
      name: "command",
      required: !command.subcommands.some((subcommand) => subcommand.default)
    });
  }
  if (args.length > 0) {
    for (const argument of args) {
      let { name } = argument;
      if (argument.multiple) {
        name += " ...";
      }
      line.push(argument.required ? name : `[${name}]`);
    }
  }
  if (command.options.length > 0) {
    line.push("[options]");
  }
  line.push(NEWLINE);
  return lineToString(line);
}
function buildCommandOptionLines(commandOptions, options, sectionTitle) {
  const filteredCommandOptions = commandOptions.filter(
    (option) => !option.deprecated && option.description !== void 0
  );
  if (filteredCommandOptions.length === 0) {
    return null;
  }
  filteredCommandOptions.sort(
    (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  let maxWidthOfUnwrappedColumns = 0;
  const rows = [];
  for (const option of filteredCommandOptions) {
    const shorthandCell = option.shorthand ? `${INDENT}-${option.shorthand},` : "";
    let longhandCell = `${INDENT}--${option.name}`;
    if (option.argument) {
      longhandCell += ` <${option.argument}>`;
    }
    longhandCell += INDENT;
    const widthOfUnwrappedColumns = shorthandCell.length + longhandCell.length;
    maxWidthOfUnwrappedColumns = Math.max(
      widthOfUnwrappedColumns,
      maxWidthOfUnwrappedColumns
    );
    rows.push([
      shorthandCell,
      longhandCell,
      {
        content: option.description,
        wordWrap: true
      }
    ]);
  }
  const finalColumnWidth = options.columns - maxWidthOfUnwrappedColumns;
  const table = new import_cli_table3.default(
    Object.assign({}, tableOptions, {
      colWidths: [null, null, finalColumnWidth]
    })
  );
  table.push(...rows);
  return [
    `${INDENT}${import_chalk.default.dim(sectionTitle)}:`,
    NEWLINE,
    NEWLINE,
    table.toString(),
    NEWLINE,
    NEWLINE
  ].join("");
}
function buildSubcommandLines(subcommands, options) {
  if (!subcommands) {
    return null;
  }
  let maxWidthOfUnwrappedColumns = 0;
  const rows = [];
  for (const command of subcommands) {
    if (command.hidden) {
      continue;
    }
    const nameCell = `${INDENT}${command.name}`;
    let argsCell = INDENT;
    argsCell += command.arguments.map((arg) => {
      return arg.required ? arg.name : `[${arg.name}]`;
    }).join(" ");
    argsCell += INDENT;
    const widthOfUnwrappedColumns = nameCell.length + argsCell.length;
    maxWidthOfUnwrappedColumns = Math.max(
      widthOfUnwrappedColumns,
      maxWidthOfUnwrappedColumns
    );
    rows.push([
      nameCell,
      argsCell,
      {
        content: command.default ? `${command.description} ${import_chalk.default.bold("(default)")}` : command.description,
        wordWrap: true
      }
    ]);
  }
  const rightMargin = INDENT.repeat(4).length;
  const finalColumnWidth = options.columns - maxWidthOfUnwrappedColumns - rightMargin;
  const table = new import_cli_table3.default(
    Object.assign({}, tableOptions, {
      colWidths: [null, null, finalColumnWidth]
    })
  );
  if (rows.length === 0) {
    return null;
  }
  table.push(...rows);
  return [
    `${INDENT}${import_chalk.default.dim("Commands")}:`,
    NEWLINE,
    NEWLINE,
    table.toString(),
    NEWLINE,
    NEWLINE
  ].join("");
}
function buildCommandExampleLines(command) {
  if (!command.examples?.length) {
    return null;
  }
  const outputArray = [`${INDENT}${import_chalk.default.dim("Examples:")}`, ""];
  for (const example of command.examples) {
    const nameLine = [INDENT];
    nameLine.push(import_chalk.default.gray("-"));
    nameLine.push(example.name);
    outputArray.push(lineToString(nameLine));
    outputArray.push("");
    const buildValueLine = (value) => {
      return lineToString([INDENT, INDENT, import_chalk.default.cyan(`$ ${value}`)]);
    };
    if (Array.isArray(example.value)) {
      for (const line of example.value) {
        outputArray.push(buildValueLine(line));
      }
    } else {
      outputArray.push(buildValueLine(example.value));
    }
    outputArray.push("");
  }
  return outputArrayToString(outputArray);
}
function buildDescriptionLine(command, options) {
  const wrappingText = wordWrap(command.description, options.columns);
  return `${wrappingText}${NEWLINE}`;
}
function buildHelpOutput(command, options) {
  const outputArray = [
    "",
    buildCommandSynopsisLine(command, options.parent),
    buildDescriptionLine(command, options),
    buildSubcommandLines(command.subcommands, options),
    buildCommandOptionLines(command.options, options, "Options"),
    buildCommandOptionLines(globalCommandOptions, options, "Global Options"),
    buildCommandExampleLines(command),
    ""
  ];
  return outputArrayToString(outputArray);
}
function help(command, options) {
  return buildHelpOutput(command, {
    ...options,
    columns: options.columns ?? 80
  });
}

export {
  help
};
