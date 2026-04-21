import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  TelemetryClient
} from "./chunk-U3WLEFHU.js";

// src/util/telemetry/commands/routes/index.ts
var RoutesTelemetryClient = class extends TelemetryClient {
  trackCliSubcommandList(actual) {
    this.trackCliSubcommand({
      subcommand: "list",
      value: actual
    });
  }
  trackCliSubcommandListVersions(actual) {
    this.trackCliSubcommand({
      subcommand: "list-versions",
      value: actual
    });
  }
  trackCliSubcommandInspect(actual) {
    this.trackCliSubcommand({
      subcommand: "inspect",
      value: actual
    });
  }
  trackCliSubcommandAdd(actual) {
    this.trackCliSubcommand({
      subcommand: "add",
      value: actual
    });
  }
  trackCliSubcommandPublish(actual) {
    this.trackCliSubcommand({
      subcommand: "publish",
      value: actual
    });
  }
  trackCliSubcommandRestore(actual) {
    this.trackCliSubcommand({
      subcommand: "restore",
      value: actual
    });
  }
  trackCliSubcommandDiscardStaging(actual) {
    this.trackCliSubcommand({
      subcommand: "discard-staging",
      value: actual
    });
  }
  trackCliSubcommandDelete(actual) {
    this.trackCliSubcommand({
      subcommand: "delete",
      value: actual
    });
  }
  trackCliSubcommandExport(actual) {
    this.trackCliSubcommand({
      subcommand: "export",
      value: actual
    });
  }
  trackCliSubcommandEnable(actual) {
    this.trackCliSubcommand({
      subcommand: "enable",
      value: actual
    });
  }
  trackCliSubcommandDisable(actual) {
    this.trackCliSubcommand({
      subcommand: "disable",
      value: actual
    });
  }
  trackCliSubcommandReorder(actual) {
    this.trackCliSubcommand({
      subcommand: "reorder",
      value: actual
    });
  }
  trackCliSubcommandEdit(actual) {
    this.trackCliSubcommand({
      subcommand: "edit",
      value: actual
    });
  }
};
var RoutesAddTelemetryClient = class extends TelemetryClient {
  // Argument tracking
  trackCliArgumentName(name) {
    if (name) {
      this.trackCliArgument({
        arg: "name",
        value: this.redactedValue
      });
    }
  }
  // Flag tracking
  trackCliFlagYes(flag) {
    if (flag) {
      this.trackCliFlag("yes");
    }
  }
  trackCliFlagDisabled(flag) {
    if (flag) {
      this.trackCliFlag("disabled");
    }
  }
  // Option tracking
  trackCliOptionSrc(src) {
    if (src) {
      this.trackCliOption({
        option: "src",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionSrcSyntax(syntax) {
    if (syntax) {
      this.trackCliOption({
        option: "src-syntax",
        value: syntax
      });
    }
  }
  trackCliOptionAction(action) {
    if (action) {
      this.trackCliOption({
        option: "action",
        value: action
      });
    }
  }
  trackCliOptionDest(dest) {
    if (dest) {
      this.trackCliOption({
        option: "dest",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionStatus(status) {
    if (status !== void 0) {
      this.trackCliOption({
        option: "status",
        value: String(status)
      });
    }
  }
  trackCliOptionPosition(position) {
    if (position) {
      const placement = position.split(":")[0];
      this.trackCliOption({
        option: "position",
        value: placement
      });
    }
  }
  trackCliOptionDescription(description) {
    if (description) {
      this.trackCliOption({
        option: "description",
        value: this.redactedValue
      });
    }
  }
  // Response header options
  trackCliOptionSetResponseHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "set-response-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendResponseHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "append-response-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteResponseHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "delete-response-header",
        value: this.redactedValue
      });
    }
  }
  // Request header options
  trackCliOptionSetRequestHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "set-request-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendRequestHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "append-request-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteRequestHeader(headers) {
    if (headers && headers.length > 0) {
      this.trackCliOption({
        option: "delete-request-header",
        value: this.redactedValue
      });
    }
  }
  // Request query options
  trackCliOptionSetRequestQuery(params) {
    if (params && params.length > 0) {
      this.trackCliOption({
        option: "set-request-query",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendRequestQuery(params) {
    if (params && params.length > 0) {
      this.trackCliOption({
        option: "append-request-query",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteRequestQuery(params) {
    if (params && params.length > 0) {
      this.trackCliOption({
        option: "delete-request-query",
        value: this.redactedValue
      });
    }
  }
  // Condition options
  trackCliOptionHas(conditions) {
    if (conditions && conditions.length > 0) {
      this.trackCliOption({
        option: "has",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionMissing(conditions) {
    if (conditions && conditions.length > 0) {
      this.trackCliOption({
        option: "missing",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAi(prompt) {
    if (prompt) {
      this.trackCliOption({
        option: "ai",
        value: this.redactedValue
      });
    }
  }
  // Custom tracking methods (not part of interface, but useful)
  trackCliActionType(actionType) {
    this.trackCliOption({
      option: "action-type",
      value: actionType
    });
  }
  trackCliFlagHasConditions(hasConditions) {
    if (hasConditions) {
      this.trackCliFlag("has-conditions");
    }
  }
  trackCliFlagMissingConditions(hasMissingConditions) {
    if (hasMissingConditions) {
      this.trackCliFlag("missing-conditions");
    }
  }
  trackCliFlagResponseHeaders(hasResponseHeaders) {
    if (hasResponseHeaders) {
      this.trackCliFlag("response-headers");
    }
  }
  trackCliFlagRequestTransforms(hasRequestTransforms) {
    if (hasRequestTransforms) {
      this.trackCliFlag("request-transforms");
    }
  }
};
var RoutesEditTelemetryClient = class extends TelemetryClient {
  trackCliArgumentNameOrId(id) {
    if (id) {
      this.trackCliArgument({ arg: "name-or-id", value: this.redactedValue });
    }
  }
  trackCliFlagYes(flag) {
    if (flag) {
      this.trackCliFlag("yes");
    }
  }
  trackCliFlagNoDest(flag) {
    if (flag) {
      this.trackCliFlag("no-dest");
    }
  }
  trackCliFlagNoStatus(flag) {
    if (flag) {
      this.trackCliFlag("no-status");
    }
  }
  trackCliFlagClearConditions(flag) {
    if (flag) {
      this.trackCliFlag("clear-conditions");
    }
  }
  trackCliFlagClearHeaders(flag) {
    if (flag) {
      this.trackCliFlag("clear-headers");
    }
  }
  trackCliFlagClearTransforms(flag) {
    if (flag) {
      this.trackCliFlag("clear-transforms");
    }
  }
  trackCliOptionName(name) {
    if (name) {
      this.trackCliOption({ option: "name", value: this.redactedValue });
    }
  }
  trackCliOptionDescription(desc) {
    if (desc) {
      this.trackCliOption({ option: "description", value: this.redactedValue });
    }
  }
  trackCliOptionSrc(src) {
    if (src) {
      this.trackCliOption({ option: "src", value: this.redactedValue });
    }
  }
  trackCliOptionSrcSyntax(syntax) {
    if (syntax) {
      this.trackCliOption({ option: "src-syntax", value: syntax });
    }
  }
  trackCliOptionAction(action) {
    if (action) {
      this.trackCliOption({ option: "action", value: action });
    }
  }
  trackCliOptionDest(dest) {
    if (dest) {
      this.trackCliOption({ option: "dest", value: this.redactedValue });
    }
  }
  trackCliOptionStatus(status) {
    if (status !== void 0) {
      this.trackCliOption({ option: "status", value: String(status) });
    }
  }
  trackCliOptionSetResponseHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "set-response-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendResponseHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "append-response-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteResponseHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "delete-response-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionSetRequestHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "set-request-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendRequestHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "append-request-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteRequestHeader(h) {
    if (h && h.length > 0) {
      this.trackCliOption({
        option: "delete-request-header",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionSetRequestQuery(p) {
    if (p && p.length > 0) {
      this.trackCliOption({
        option: "set-request-query",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionAppendRequestQuery(p) {
    if (p && p.length > 0) {
      this.trackCliOption({
        option: "append-request-query",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionDeleteRequestQuery(p) {
    if (p && p.length > 0) {
      this.trackCliOption({
        option: "delete-request-query",
        value: this.redactedValue
      });
    }
  }
  trackCliOptionHas(conditions) {
    if (conditions && conditions.length > 0) {
      this.trackCliOption({ option: "has", value: this.redactedValue });
    }
  }
  trackCliOptionMissing(conditions) {
    if (conditions && conditions.length > 0) {
      this.trackCliOption({ option: "missing", value: this.redactedValue });
    }
  }
  trackCliOptionAi(prompt) {
    if (prompt) {
      this.trackCliOption({
        option: "ai",
        value: this.redactedValue
      });
    }
  }
};

export {
  RoutesTelemetryClient,
  RoutesAddTelemetryClient,
  RoutesEditTelemetryClient
};
