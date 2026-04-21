import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  require_dist
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __commonJS,
  __esm,
  __export,
  __require,
  __toESM
} from "./chunk-TZ2YI2VH.js";

// ../../internals/get-package-json/dist/index.js
var require_dist2 = __commonJS({
  "../../internals/get-package-json/dist/index.js"(exports, module) {
    "use strict";
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var src_exports = {};
    __export2(src_exports, {
      getPackageJSON: () => getPackageJSON2
    });
    module.exports = __toCommonJS(src_exports);
    var import_fs = __toESM2(__require("fs"));
    var import_path = __toESM2(__require("path"));
    var import_url = __require("url");
    var cache = /* @__PURE__ */ new Map();
    function getPackageJSONPath(dir) {
      return import_path.default.join(dir, "package.json");
    }
    function captureCallerCallSite() {
      const _prepareStackTrace = Error.prepareStackTrace;
      let callSite;
      try {
        Error.prepareStackTrace = (_, stack) => stack;
        const callSites = new Error().stack;
        callSite = callSites[2];
      } finally {
        Error.prepareStackTrace = _prepareStackTrace;
      }
      return callSite;
    }
    function getPackageJSON2() {
      const callSite = captureCallerCallSite();
      let filePath = callSite.getFileName() || callSite.getEvalOrigin();
      if (filePath.startsWith("file://")) {
        filePath = (0, import_url.fileURLToPath)(filePath);
      }
      let rootDir = import_path.default.dirname(filePath);
      let packageJSONPath = getPackageJSONPath(rootDir);
      while (!import_fs.default.existsSync(packageJSONPath)) {
        rootDir = import_path.default.join(rootDir, "..");
        packageJSONPath = getPackageJSONPath(rootDir);
      }
      let packageJSON = cache.get(packageJSONPath);
      if (!packageJSON) {
        packageJSON = JSON.parse(import_fs.default.readFileSync(packageJSONPath, "utf-8"));
        cache.set(packageJSONPath, packageJSON);
      }
      return packageJSON;
    }
  }
});

// src/util/pkg.ts
var pkg_exports = {};
__export(pkg_exports, {
  default: () => pkg_default
});
var import_get_package_json, pkg_default;
var init_pkg = __esm({
  "src/util/pkg.ts"() {
    "use strict";
    import_get_package_json = __toESM(require_dist2(), 1);
    pkg_default = (0, import_get_package_json.getPackageJSON)();
  }
});

// ../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/lower-case.js
var require_lower_case = __commonJS({
  "../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/lower-case.js"(exports, module) {
    var conjunctions = [
      "for",
      "and",
      "nor",
      "but",
      "or",
      "yet",
      "so"
    ];
    var articles = [
      "a",
      "an",
      "the"
    ];
    var prepositions = [
      "aboard",
      "about",
      "above",
      "across",
      "after",
      "against",
      "along",
      "amid",
      "among",
      "anti",
      "around",
      "as",
      "at",
      "before",
      "behind",
      "below",
      "beneath",
      "beside",
      "besides",
      "between",
      "beyond",
      "but",
      "by",
      "concerning",
      "considering",
      "despite",
      "down",
      "during",
      "except",
      "excepting",
      "excluding",
      "following",
      "for",
      "from",
      "in",
      "inside",
      "into",
      "like",
      "minus",
      "near",
      "of",
      "off",
      "on",
      "onto",
      "opposite",
      "over",
      "past",
      "per",
      "plus",
      "regarding",
      "round",
      "save",
      "since",
      "than",
      "through",
      "to",
      "toward",
      "towards",
      "under",
      "underneath",
      "unlike",
      "until",
      "up",
      "upon",
      "versus",
      "via",
      "with",
      "within",
      "without"
    ];
    module.exports = /* @__PURE__ */ new Set([
      ...conjunctions,
      ...articles,
      ...prepositions
    ]);
  }
});

// ../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/specials.js
var require_specials = __commonJS({
  "../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/specials.js"(exports, module) {
    var intended = [
      "ZEIT",
      "ZEIT Inc.",
      "CLI",
      "API",
      "HTTP",
      "HTTPS",
      "JSX",
      "DNS",
      "URL",
      "now.sh",
      "now.json",
      "CI",
      "CDN",
      "package.json",
      "GitHub",
      "CSS",
      "JS",
      "HTML",
      "WordPress",
      "JavaScript",
      "Next.js",
      "Node.js"
    ];
    module.exports = intended;
  }
});

// ../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/.pnpm/title@3.4.1/node_modules/title/lib/index.js"(exports, module) {
    var lowerCase = require_lower_case();
    var specials = require_specials();
    var regex = /(?:(?:(\s?(?:^|[.\(\)!?;:"-])\s*)(\w))|(\w))(\w*[’']*\w*)/g;
    var convertToRegExp = (specials2) => specials2.map((s) => [new RegExp(`\\b${s}\\b`, "gi"), s]);
    function parseMatch(match) {
      const firstCharacter = match[0];
      if (/\s/.test(firstCharacter)) {
        return match.substr(1);
      }
      if (/[\(\)]/.test(firstCharacter)) {
        return null;
      }
      return match;
    }
    module.exports = (str, options = {}) => {
      str = str.toLowerCase().replace(regex, (m, lead = "", forced, lower, rest) => {
        const parsedMatch = parseMatch(m);
        if (!parsedMatch) {
          return m;
        }
        if (!forced) {
          const fullLower = lower + rest;
          if (lowerCase.has(fullLower)) {
            return parsedMatch;
          }
        }
        return lead + (lower || forced).toUpperCase() + rest;
      });
      const customSpecials = options.special || [];
      const replace = [...specials, ...customSpecials];
      const replaceRegExp = convertToRegExp(replace);
      replaceRegExp.forEach(([pattern, s]) => {
        str = str.replace(pattern, s);
      });
      return str;
    };
  }
});

// ../../node_modules/.pnpm/bytes@3.0.0/node_modules/bytes/index.js
var require_bytes = __commonJS({
  "../../node_modules/.pnpm/bytes@3.0.0/node_modules/bytes/index.js"(exports, module) {
    "use strict";
    module.exports = bytes2;
    module.exports.format = format;
    module.exports.parse = parse;
    var formatThousandsRegExp = /\B(?=(\d{3})+(?!\d))/g;
    var formatDecimalsRegExp = /(?:\.0*|(\.[^0]+)0+)$/;
    var map = {
      b: 1,
      kb: 1 << 10,
      mb: 1 << 20,
      gb: 1 << 30,
      tb: (1 << 30) * 1024
    };
    var parseRegExp = /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb)$/i;
    function bytes2(value, options) {
      if (typeof value === "string") {
        return parse(value);
      }
      if (typeof value === "number") {
        return format(value, options);
      }
      return null;
    }
    function format(value, options) {
      if (!Number.isFinite(value)) {
        return null;
      }
      var mag = Math.abs(value);
      var thousandsSeparator = options && options.thousandsSeparator || "";
      var unitSeparator = options && options.unitSeparator || "";
      var decimalPlaces = options && options.decimalPlaces !== void 0 ? options.decimalPlaces : 2;
      var fixedDecimals = Boolean(options && options.fixedDecimals);
      var unit = options && options.unit || "";
      if (!unit || !map[unit.toLowerCase()]) {
        if (mag >= map.tb) {
          unit = "TB";
        } else if (mag >= map.gb) {
          unit = "GB";
        } else if (mag >= map.mb) {
          unit = "MB";
        } else if (mag >= map.kb) {
          unit = "KB";
        } else {
          unit = "B";
        }
      }
      var val = value / map[unit.toLowerCase()];
      var str = val.toFixed(decimalPlaces);
      if (!fixedDecimals) {
        str = str.replace(formatDecimalsRegExp, "$1");
      }
      if (thousandsSeparator) {
        str = str.replace(formatThousandsRegExp, thousandsSeparator);
      }
      return str + unitSeparator + unit;
    }
    function parse(val) {
      if (typeof val === "number" && !isNaN(val)) {
        return val;
      }
      if (typeof val !== "string") {
        return null;
      }
      var results = parseRegExp.exec(val);
      var floatValue;
      var unit = "b";
      if (!results) {
        floatValue = parseInt(val, 10);
        unit = "b";
      } else {
        floatValue = parseFloat(results[1]);
        unit = results[4].toLowerCase();
      }
      return Math.floor(map[unit] * floatValue);
    }
  }
});

// src/util/output/cmd.ts
var import_chalk = __toESM(require_source(), 1);
function cmd(text) {
  return `${import_chalk.default.gray("`")}${import_chalk.default.cyan(text)}${import_chalk.default.gray("`")}`;
}

// src/util/pkg-name.ts
var import_title = __toESM(require_lib(), 1);
init_pkg();
var packageName = pkg_default.name;
function getTitleName() {
  const str = packageName;
  return (0, import_title.default)(str);
}
function getCommandName(subcommands) {
  let vercel = packageName;
  if (subcommands) {
    vercel = `${vercel} ${subcommands}`;
  }
  return cmd(vercel);
}
function getCommandNamePlain(subcommands) {
  return subcommands ? `${packageName} ${subcommands}` : packageName;
}

// src/util/now-error.ts
var NowError = class extends Error {
  constructor({
    code: code2,
    message,
    meta
  }) {
    super(message);
    this.code = code2;
    this.meta = meta;
  }
};

// src/util/output/code.ts
var import_chalk2 = __toESM(require_source(), 1);
function code(cmd2, { backticks = true } = {}) {
  const tick = backticks ? import_chalk2.default.gray("`") : "";
  return `${tick}${import_chalk2.default.bold(cmd2)}${tick}`;
}

// src/util/errors-ts.ts
var import_bytes = __toESM(require_bytes(), 1);
import { NowBuildError } from "@vercel/build-utils";
var import_chalk3 = __toESM(require_source(), 1);
var import_error_utils = __toESM(require_dist(), 1);
var APIError = class extends Error {
  constructor(message, response, body) {
    super();
    this.message = `${message} (${response.status})`;
    this.status = response.status;
    this.serverMessage = message;
    if (body) {
      for (const field of Object.keys(body)) {
        if (field !== "message") {
          this[field] = body[field];
        }
      }
    }
    if (response.status === 429 || response.status === 503) {
      const parsed = parseRetryAfterHeaderAsMillis(
        response.headers.get("Retry-After")
      );
      this.retryAfterMs = parsed ?? (response.status === 429 ? 0 : void 0);
    }
  }
};
function parseRetryAfterHeaderAsMillis(header) {
  if (!header)
    return void 0;
  let retryAfterMs = Number(header) * 1e3;
  if (Number.isNaN(retryAfterMs)) {
    retryAfterMs = Date.parse(header);
    if (Number.isNaN(retryAfterMs)) {
      return void 0;
    } else {
      retryAfterMs = retryAfterMs - Date.now();
    }
  }
  return Math.max(retryAfterMs, 0);
}
function isAPIError(v) {
  return (0, import_error_utils.isError)(v) && "status" in v;
}
var TeamDeleted = class extends NowError {
  constructor() {
    super({
      code: "TEAM_DELETED",
      message: `Your team was deleted or you were removed from the team. You can switch to a different one using ${getCommandName(
        `switch`
      )}.`,
      meta: {}
    });
  }
};
var InvalidToken = class extends NowError {
  constructor(tokenSource) {
    let message;
    if (tokenSource === "flag") {
      message = "The token provided via `--token` argument is not valid. Please provide a valid token.";
    } else if (tokenSource === "env") {
      message = "The token provided via VERCEL_TOKEN environment variable is not valid. Please provide a valid token.";
    } else {
      message = `The specified token is not valid. Use ${getCommandName(
        "login"
      )} to generate a new token.`;
    }
    super({
      code: "NOT_AUTHORIZED",
      message,
      meta: {}
    });
  }
};
var MissingUser = class extends NowError {
  constructor() {
    super({
      code: "MISSING_USER",
      message: `Not able to load user, missing from response`,
      meta: {}
    });
  }
};
var DomainAlreadyExists = class extends NowError {
  constructor(domain) {
    super({
      code: "DOMAIN_ALREADY_EXISTS",
      meta: { domain },
      message: `The domain ${domain} already exists under a different context.`
    });
  }
};
var DomainPermissionDenied = class extends NowError {
  constructor(domain, context) {
    super({
      code: "DOMAIN_PERMISSION_DENIED",
      meta: { domain, context },
      message: `You don't have access to the domain ${domain} under ${context}.`
    });
  }
};
var DomainExternal = class extends NowError {
  constructor(domain) {
    super({
      code: "DOMAIN_EXTERNAL",
      meta: { domain },
      message: `The domain ${domain} must point to zeit.world.`
    });
  }
};
var SourceNotFound = class extends NowError {
  constructor() {
    super({
      code: "SOURCE_NOT_FOUND",
      meta: {},
      message: `Not able to purchase. Please add a payment method using the dashboard.`
    });
  }
};
var DomainNotFound = class extends NowError {
  constructor(domain, contextName) {
    super({
      code: "DOMAIN_NOT_FOUND",
      meta: { domain },
      message: `Domain not found by "${domain}"${contextName ? ` under ${import_chalk3.default.bold(contextName)}` : ""}.`
    });
  }
};
var DomainNotVerified = class extends NowError {
  constructor(domain) {
    super({
      code: "DOMAIN_NOT_VERIFIED",
      meta: { domain },
      message: `The domain ${domain} is not verified.`
    });
  }
};
var DomainVerificationFailed = class extends NowError {
  constructor({
    domain,
    nsVerification,
    txtVerification,
    purchased = false
  }) {
    super({
      code: "DOMAIN_VERIFICATION_FAILED",
      meta: { domain, nsVerification, txtVerification, purchased },
      message: `We can't verify the domain ${domain}. Both Name Servers and DNS TXT verifications failed.`
    });
  }
};
var InvalidDomain = class extends NowError {
  constructor(domain, message) {
    super({
      code: "INVALID_DOMAIN",
      meta: { domain },
      message: message || `The domain ${domain} is not valid.`
    });
  }
};
var NotDomainOwner = class extends NowError {
  constructor(message) {
    super({
      code: "NOT_DOMAIN_OWNER",
      meta: {},
      message
    });
  }
};
var InvalidDeploymentId = class extends NowError {
  constructor(id) {
    super({
      code: "INVALID_DEPLOYMENT_ID",
      meta: { id },
      message: `The deployment id "${id}" is not valid.`
    });
  }
};
var UnsupportedTLD = class extends NowError {
  constructor(domain) {
    super({
      code: "UNSUPPORTED_TLD",
      meta: { domain },
      message: `The TLD for domain name ${domain} is not supported.`
    });
  }
};
var TLDNotSupportedViaCLI = class extends NowError {
  constructor(domain) {
    super({
      code: "UNSUPPORTED_TLD_VIA_CLI",
      meta: { domain },
      message: `Purchased for the TLD for domain name ${domain} are not supported via the CLI. Use the REST API or the dashboard to purchase.`
    });
  }
};
var DomainNotAvailable = class extends NowError {
  constructor(domain) {
    super({
      code: "DOMAIN_NOT_AVAILABLE",
      meta: { domain },
      message: `The domain ${domain} is not available to be purchased.`
    });
  }
};
var UnexpectedDomainPurchaseError = class extends NowError {
  constructor(domain) {
    super({
      code: "UNEXPECTED_DOMAIN_PURCHASE_ERROR",
      meta: { domain },
      message: `An unexpected error happened while purchasing.`
    });
  }
};
var UnexpectedDomainTransferError = class extends NowError {
  constructor(domain) {
    super({
      code: "UNEXPECTED_DOMAIN_TRANSFER_ERROR",
      meta: { domain },
      message: `An unexpected error happened while transferring.`
    });
  }
};
var DomainPaymentError = class extends NowError {
  constructor() {
    super({
      code: "DOMAIN_PAYMENT_ERROR",
      meta: {},
      message: `Your card was declined.`
    });
  }
};
var DomainPurchasePending = class extends NowError {
  constructor(domain) {
    super({
      code: "DOMAIN_PURCHASE_PENDING",
      meta: { domain },
      message: `The domain purchase for ${domain} is pending.`
    });
  }
};
var UserAborted = class extends NowError {
  constructor() {
    super({
      code: "USER_ABORTED",
      meta: {},
      message: `The user canceled the operation.`
    });
  }
};
var CertNotFound = class extends NowError {
  constructor(id) {
    super({
      code: "CERT_NOT_FOUND",
      meta: { id },
      message: `The cert ${id} can't be found.`
    });
  }
};
var CertsPermissionDenied = class extends NowError {
  constructor(context, domain) {
    super({
      code: "CERTS_PERMISSION_DENIED",
      meta: { domain },
      message: `You don't have access to ${domain}'s certs under ${context}.`
    });
  }
};
var CertOrderNotFound = class extends NowError {
  constructor(cns) {
    super({
      code: "CERT_ORDER_NOT_FOUND",
      meta: { cns },
      message: `No cert order could be found for cns ${cns.join(" ,")}`
    });
  }
};
var TooManyRequests = class extends NowError {
  constructor(api, retryAfterMs) {
    super({
      code: "TOO_MANY_REQUESTS",
      meta: { api, retryAfterMs },
      message: `Rate limited. Too many requests to the same endpoint.`
    });
  }
};
var CertError = class extends NowError {
  constructor({
    cns,
    code: code2,
    message,
    helpUrl
  }) {
    super({
      code: `CERT_ERROR`,
      meta: { cns, code: code2, helpUrl },
      message
    });
  }
};
var CertConfigurationError = class extends NowError {
  constructor({
    cns,
    message,
    external,
    type,
    helpUrl
  }) {
    super({
      code: `CERT_CONFIGURATION_ERROR`,
      meta: { cns, helpUrl, external, type },
      message
    });
  }
};
var DeploymentNotFound = class extends NowError {
  constructor({ context, id = "" }) {
    super({
      code: "DEPLOYMENT_NOT_FOUND",
      meta: { id, context },
      message: `Can't find the deployment "${id}" under the context "${context}"`
    });
  }
};
var DeploymentNotReady = class extends NowError {
  constructor({ url = "" }) {
    super({
      code: "DEPLOYMENT_NOT_READY",
      meta: { url },
      message: `The deployment https://${url} is not ready.`
    });
  }
};
var DeploymentFailedAliasImpossible = class extends NowError {
  constructor() {
    super({
      code: "DEPLOYMENT_FAILED_ALIAS_IMPOSSIBLE",
      meta: {},
      message: `The deployment build has failed and cannot be aliased`
    });
  }
};
var DeploymentPermissionDenied = class extends NowError {
  constructor(id, context) {
    super({
      code: "DEPLOYMENT_PERMISSION_DENIED",
      meta: { id, context },
      message: `You don't have access to the deployment ${id} under ${context}.`
    });
  }
};
var InvalidAlias = class extends NowError {
  constructor(alias) {
    super({
      code: "INVALID_ALIAS",
      meta: { alias },
      message: `The given alias ${alias} is not valid`
    });
  }
};
var AliasInUse = class extends NowError {
  constructor(alias) {
    super({
      code: "ALIAS_IN_USE",
      meta: { alias },
      message: `The alias is already in use`
    });
  }
};
var CertMissing = class extends NowError {
  constructor(domain) {
    super({
      code: "CERT_MISSING",
      meta: { domain },
      message: `The certificate for domain ${domain} is missing`
    });
  }
};
var CantParseJSONFile = class extends NowError {
  constructor(file, parseErrorLocation) {
    const message = `Can't parse json file ${file}: ${parseErrorLocation}`;
    super({
      code: "CANT_PARSE_JSON_FILE",
      meta: { file, parseErrorLocation },
      message
    });
  }
};
var ConflictingConfigFiles = class extends NowBuildError {
  constructor(files, message, link) {
    super({
      code: "CONFLICTING_CONFIG_FILES",
      message: message || "Cannot use both a `vercel.json` and `now.json` file. Please delete the `now.json` file.",
      link: link || "https://vercel.link/combining-old-and-new-config"
    });
    this.files = files;
  }
};
var CantFindConfig = class extends NowError {
  constructor(paths) {
    super({
      code: "CANT_FIND_CONFIG",
      meta: { paths },
      message: `Can't find a configuration file in the given locations.`
    });
  }
};
var WorkingDirectoryDoesNotExist = class extends NowError {
  constructor() {
    super({
      code: "CWD_DOES_NOT_EXIST",
      meta: {},
      message: "The current working directory does not exist."
    });
  }
};
var NoAliasInConfig = class extends NowError {
  constructor() {
    super({
      code: "NO_ALIAS_IN_CONFIG",
      meta: {},
      message: `There is no alias set up in config file.`
    });
  }
};
var InvalidAliasInConfig = class extends NowError {
  constructor(value) {
    super({
      code: "INVALID_ALIAS_IN_CONFIG",
      meta: { value },
      message: `Invalid alias option in configuration.`
    });
  }
};
var DNSPermissionDenied = class extends NowError {
  constructor(domain) {
    super({
      code: "DNS_PERMISSION_DENIED",
      meta: { domain },
      message: `You don't have access to the DNS records of ${domain}.`
    });
  }
};
var DNSInvalidPort = class extends NowError {
  constructor() {
    super({
      code: "DNS_INVALID_PORT",
      meta: {},
      message: `Invalid <port> parameter. A number was expected`
    });
  }
};
var DNSInvalidType = class extends NowError {
  constructor(type) {
    super({
      code: "DNS_INVALID_TYPE",
      meta: { type },
      message: `Invalid <type> parameter "${type}". Expected one of A, AAAA, ALIAS, CAA, CNAME, MX, SRV, TXT`
    });
  }
};
var DNSConflictingRecord = class extends NowError {
  constructor(record) {
    super({
      code: "DNS_CONFLICTING_RECORD",
      meta: { record },
      message: ` A conflicting record exists "${record}".`
    });
  }
};
var DomainRemovalConflict = class extends NowError {
  constructor({
    aliases,
    certs,
    message,
    pendingAsyncPurchase,
    resolvable,
    suffix,
    transferring
  }) {
    super({
      code: "domain_removal_conflict",
      meta: {
        aliases,
        certs,
        pendingAsyncPurchase,
        suffix,
        transferring,
        resolvable
      },
      message
    });
  }
};
var DomainMoveConflict = class extends NowError {
  constructor({
    message,
    pendingAsyncPurchase,
    resolvable,
    suffix
  }) {
    super({
      code: "domain_move_conflict",
      meta: {
        pendingAsyncPurchase,
        resolvable,
        suffix
      },
      message
    });
  }
};
var InvalidMoveDestination = class extends NowError {
  constructor(destination) {
    super({
      code: "INVALID_MOVE_DESTINATION",
      message: `Invalid move destination "${destination}"`,
      meta: { destination }
    });
  }
};
var LambdaSizeExceededError = class extends NowError {
  constructor(size, maxLambdaSize) {
    super({
      code: "MAX_LAMBDA_SIZE_EXCEEDED",
      message: `The lambda function size (${(0, import_bytes.default)(
        size
      ).toLowerCase()}) exceeds the maximum size limit (${(0, import_bytes.default)(
        maxLambdaSize
      ).toLowerCase()}).`,
      meta: { size, maxLambdaSize }
    });
  }
};
var MissingDotenvVarsError = class extends NowError {
  constructor(type, missing) {
    let message;
    if (missing.length === 1) {
      message = `Env var ${JSON.stringify(missing[0])} is not defined in ${code(
        type
      )} file`;
    } else {
      message = [
        `The following env vars are not defined in ${code(type)} file:`,
        ...missing.map((name) => `  - ${JSON.stringify(name)}`)
      ].join("\n");
    }
    message += "\nRead more: https://err.sh/vercel/missing-env-file";
    super({
      code: "MISSING_DOTENV_VARS",
      message,
      meta: { type, missing }
    });
  }
};
var DeploymentsRateLimited = class extends NowError {
  constructor(message) {
    super({
      code: "DEPLOYMENTS_RATE_LIMITED",
      meta: {},
      message
    });
  }
};
var BuildsRateLimited = class extends NowError {
  constructor(message) {
    super({
      code: "BUILDS_RATE_LIMITED",
      meta: {},
      message
    });
  }
};
var ProjectNotFound = class extends NowError {
  constructor(nameOrId) {
    super({
      code: "PROJECT_NOT_FOUND",
      meta: {},
      message: `There is no project for "${nameOrId}"`
    });
  }
};
var LinkRequiredError = class extends NowError {
  constructor(message = "No project is linked in this directory. Run `vercel link` or pass a project name.") {
    super({
      code: "LINK_REQUIRED",
      meta: {},
      message
    });
  }
};
var AliasDomainConfigured = class extends NowError {
  constructor({ message }) {
    super({
      code: "DOMAIN_CONFIGURED",
      meta: {},
      message
    });
  }
};
var MissingBuildScript = class extends NowError {
  constructor({ message }) {
    super({
      code: "MISSING_BUILD_SCRIPT",
      meta: {},
      message
    });
  }
};
var ConflictingFilePath = class extends NowError {
  constructor({ message }) {
    super({
      code: "CONFLICTING_FILE_PATH",
      meta: {},
      message
    });
  }
};
var ConflictingPathSegment = class extends NowError {
  constructor({ message }) {
    super({
      code: "CONFLICTING_PATH_SEGMENT",
      meta: {},
      message
    });
  }
};
var BuildError = class extends NowError {
  constructor({
    message,
    meta
  }) {
    super({
      code: "BUILD_ERROR",
      meta,
      message
    });
  }
};
var SchemaValidationFailed = class extends NowError {
  constructor(message, keyword, dataPath, params) {
    super({
      code: "SCHEMA_VALIDATION_FAILED",
      meta: { message, keyword, dataPath, params },
      message: `Schema verification failed`
    });
  }
};
var InvalidLocalConfig = class extends NowError {
  constructor(value) {
    super({
      code: "INVALID_LOCAL_CONFIG",
      meta: { value },
      message: `Invalid local config parameter [${value.map((localConfig) => `"${localConfig}"`).join(", ")}]. A string was expected.`
    });
  }
};

export {
  pkg_default,
  pkg_exports,
  init_pkg,
  require_lib,
  cmd,
  packageName,
  getTitleName,
  getCommandName,
  getCommandNamePlain,
  require_bytes,
  NowError,
  code,
  APIError,
  parseRetryAfterHeaderAsMillis,
  isAPIError,
  TeamDeleted,
  InvalidToken,
  MissingUser,
  DomainAlreadyExists,
  DomainPermissionDenied,
  DomainExternal,
  SourceNotFound,
  DomainNotFound,
  DomainNotVerified,
  DomainVerificationFailed,
  InvalidDomain,
  NotDomainOwner,
  InvalidDeploymentId,
  UnsupportedTLD,
  TLDNotSupportedViaCLI,
  DomainNotAvailable,
  UnexpectedDomainPurchaseError,
  UnexpectedDomainTransferError,
  DomainPaymentError,
  DomainPurchasePending,
  UserAborted,
  CertNotFound,
  CertsPermissionDenied,
  CertOrderNotFound,
  TooManyRequests,
  CertError,
  CertConfigurationError,
  DeploymentNotFound,
  DeploymentNotReady,
  DeploymentFailedAliasImpossible,
  DeploymentPermissionDenied,
  InvalidAlias,
  AliasInUse,
  CertMissing,
  CantParseJSONFile,
  ConflictingConfigFiles,
  CantFindConfig,
  WorkingDirectoryDoesNotExist,
  NoAliasInConfig,
  InvalidAliasInConfig,
  DNSPermissionDenied,
  DNSInvalidPort,
  DNSInvalidType,
  DNSConflictingRecord,
  DomainRemovalConflict,
  DomainMoveConflict,
  InvalidMoveDestination,
  LambdaSizeExceededError,
  MissingDotenvVarsError,
  DeploymentsRateLimited,
  BuildsRateLimited,
  ProjectNotFound,
  LinkRequiredError,
  AliasDomainConfigured,
  MissingBuildScript,
  ConflictingFilePath,
  ConflictingPathSegment,
  BuildError,
  SchemaValidationFailed,
  InvalidLocalConfig
};
/*! Bundled license information:

bytes/index.js:
  (*!
   * bytes
   * Copyright(c) 2012-2014 TJ Holowaychuk
   * Copyright(c) 2015 Jed Watson
   * MIT Licensed
   *)
*/
