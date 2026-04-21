import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  highlight
} from "./chunk-V5P25P7F.js";
import {
  ua_default
} from "./chunk-4PQA6H63.js";
import {
  getLocalPathConfig
} from "./chunk-KUY7VLTK.js";
import {
  autoInstallVercelPlugin
} from "./chunk-UBOSX7RM.js";
import {
  DEFAULT_VERCEL_CONFIG_FILENAME,
  VERCEL_CONFIG_EXTENSIONS,
  VERCEL_DIR,
  createPrompt,
  esm_default,
  esm_default2,
  esm_default3,
  getUser,
  global_path_default,
  humanizePath,
  isBackspaceKey,
  isEnterKey,
  isVercelTomlEnabled,
  makeTheme,
  onExit,
  require_cli_width,
  require_dist as require_dist2,
  require_lib2 as require_lib,
  require_lib3 as require_lib2,
  require_source as require_source2,
  require_wrap_ansi,
  useKeypress,
  usePrefix,
  useState
} from "./chunk-U7MQBM3F.js";
import {
  require_load_json_file,
  require_write_json_file
} from "./chunk-U3WLEFHU.js";
import {
  printError,
  require_strip_ansi
} from "./chunk-RFMC2QXQ.js";
import {
  APIError,
  NowError,
  getCommandName
} from "./chunk-ECRBC4HL.js";
import {
  emoji,
  link_default,
  output_manager_default,
  prependEmoji,
  require_ansi_escapes,
  require_dist
} from "./chunk-ZQKJVHXY.js";
import {
  require_source
} from "./chunk-S7KYDPEM.js";
import {
  __commonJS,
  __publicField,
  __require,
  __toESM
} from "./chunk-TZ2YI2VH.js";

// ../../node_modules/.pnpm/yoctocolors-cjs@2.1.3/node_modules/yoctocolors-cjs/index.js
var require_yoctocolors_cjs = __commonJS({
  "../../node_modules/.pnpm/yoctocolors-cjs@2.1.3/node_modules/yoctocolors-cjs/index.js"(exports, module) {
    var tty = __require("tty");
    var hasColors = tty?.WriteStream?.prototype?.hasColors?.() ?? false;
    var format = (open2, close) => {
      if (!hasColors) {
        return (input) => input;
      }
      const openCode = `\x1B[${open2}m`;
      const closeCode = `\x1B[${close}m`;
      return (input) => {
        const string = input + "";
        let index = string.indexOf(closeCode);
        if (index === -1) {
          return openCode + string + closeCode;
        }
        let result = openCode;
        let lastIndex = 0;
        const reopenOnNestedClose = close === 22;
        const replaceCode = (reopenOnNestedClose ? closeCode : "") + openCode;
        while (index !== -1) {
          result += string.slice(lastIndex, index) + replaceCode;
          lastIndex = index + closeCode.length;
          index = string.indexOf(closeCode, lastIndex);
        }
        result += string.slice(lastIndex) + closeCode;
        return result;
      };
    };
    var colors4 = {};
    colors4.reset = format(0, 0);
    colors4.bold = format(1, 22);
    colors4.dim = format(2, 22);
    colors4.italic = format(3, 23);
    colors4.underline = format(4, 24);
    colors4.overline = format(53, 55);
    colors4.inverse = format(7, 27);
    colors4.hidden = format(8, 28);
    colors4.strikethrough = format(9, 29);
    colors4.black = format(30, 39);
    colors4.red = format(31, 39);
    colors4.green = format(32, 39);
    colors4.yellow = format(33, 39);
    colors4.blue = format(34, 39);
    colors4.magenta = format(35, 39);
    colors4.cyan = format(36, 39);
    colors4.white = format(37, 39);
    colors4.gray = format(90, 39);
    colors4.bgBlack = format(40, 49);
    colors4.bgRed = format(41, 49);
    colors4.bgGreen = format(42, 49);
    colors4.bgYellow = format(43, 49);
    colors4.bgBlue = format(44, 49);
    colors4.bgMagenta = format(45, 49);
    colors4.bgCyan = format(46, 49);
    colors4.bgWhite = format(47, 49);
    colors4.bgGray = format(100, 49);
    colors4.redBright = format(91, 39);
    colors4.greenBright = format(92, 39);
    colors4.yellowBright = format(93, 39);
    colors4.blueBright = format(94, 39);
    colors4.magentaBright = format(95, 39);
    colors4.cyanBright = format(96, 39);
    colors4.whiteBright = format(97, 39);
    colors4.bgRedBright = format(101, 49);
    colors4.bgGreenBright = format(102, 49);
    colors4.bgYellowBright = format(103, 49);
    colors4.bgBlueBright = format(104, 49);
    colors4.bgMagentaBright = format(105, 49);
    colors4.bgCyanBright = format(106, 49);
    colors4.bgWhiteBright = format(107, 49);
    module.exports = colors4;
  }
});

// ../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._timeouts = timeouts;
      this._options = options || {};
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (this._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// ../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper() {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original.apply(obj, args);
          });
        };
        obj[method].options = options;
      }
    };
  }
});

// ../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/index.js
var require_retry2 = __commonJS({
  "../../node_modules/.pnpm/retry@0.10.1/node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// ../../node_modules/.pnpm/async-retry@1.1.3/node_modules/async-retry/dist/index.js
var require_dist3 = __commonJS({
  "../../node_modules/.pnpm/async-retry@1.1.3/node_modules/async-retry/dist/index.js"(exports, module) {
    "use strict";
    var retrier = require_retry2();
    module.exports = function(fn, opts) {
      opts = opts || {};
      return new Promise(function(resolve, reject) {
        var op = retrier.operation(opts);
        var bail = function bail2(err) {
          return reject(err || new Error("Aborted"));
        };
        var onError = function onError2(err) {
          if (err.bail) {
            return bail(err);
          }
          if (!op.retry(err)) {
            reject(op.mainError());
          } else if (opts.onRetry) {
            opts.onRetry(err);
          }
        };
        op.attempt(function(num) {
          var val = void 0;
          try {
            val = fn(bail, num);
          } catch (err) {
            return onError(err);
          }
          Promise.resolve(val).then(resolve, onError);
        });
      });
    };
  }
});

// ../../node_modules/.pnpm/is-docker@2.2.1/node_modules/is-docker/index.js
var require_is_docker = __commonJS({
  "../../node_modules/.pnpm/is-docker@2.2.1/node_modules/is-docker/index.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var isDocker;
    function hasDockerEnv() {
      try {
        fs.statSync("/.dockerenv");
        return true;
      } catch (_) {
        return false;
      }
    }
    function hasDockerCGroup() {
      try {
        return fs.readFileSync("/proc/self/cgroup", "utf8").includes("docker");
      } catch (_) {
        return false;
      }
    }
    module.exports = () => {
      if (isDocker === void 0) {
        isDocker = hasDockerEnv() || hasDockerCGroup();
      }
      return isDocker;
    };
  }
});

// ../../node_modules/.pnpm/is-wsl@2.2.0/node_modules/is-wsl/index.js
var require_is_wsl = __commonJS({
  "../../node_modules/.pnpm/is-wsl@2.2.0/node_modules/is-wsl/index.js"(exports, module) {
    "use strict";
    var os = __require("os");
    var fs = __require("fs");
    var isDocker = require_is_docker();
    var isWsl = () => {
      if (process.platform !== "linux") {
        return false;
      }
      if (os.release().toLowerCase().includes("microsoft")) {
        if (isDocker()) {
          return false;
        }
        return true;
      }
      try {
        return fs.readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft") ? !isDocker() : false;
      } catch (_) {
        return false;
      }
    };
    if (process.env.__IS_WSL_TEST__) {
      module.exports = isWsl;
    } else {
      module.exports = isWsl();
    }
  }
});

// ../../node_modules/.pnpm/define-lazy-prop@2.0.0/node_modules/define-lazy-prop/index.js
var require_define_lazy_prop = __commonJS({
  "../../node_modules/.pnpm/define-lazy-prop@2.0.0/node_modules/define-lazy-prop/index.js"(exports, module) {
    "use strict";
    module.exports = (object, propertyName, fn) => {
      const define = (value) => Object.defineProperty(object, propertyName, { value, enumerable: true, writable: true });
      Object.defineProperty(object, propertyName, {
        configurable: true,
        enumerable: true,
        get() {
          const result = fn();
          define(result);
          return result;
        },
        set(value) {
          define(value);
        }
      });
      return object;
    };
  }
});

// ../../node_modules/.pnpm/open@8.4.0/node_modules/open/index.js
var require_open = __commonJS({
  "../../node_modules/.pnpm/open@8.4.0/node_modules/open/index.js"(exports, module) {
    var path = __require("path");
    var childProcess = __require("child_process");
    var { promises: fs, constants: fsConstants } = __require("fs");
    var isWsl = require_is_wsl();
    var isDocker = require_is_docker();
    var defineLazyProperty = require_define_lazy_prop();
    var localXdgOpenPath = path.join(__dirname, "xdg-open");
    var { platform, arch } = process;
    var getWslDrivesMountPoint = (() => {
      const defaultMountPoint = "/mnt/";
      let mountPoint;
      return async function() {
        if (mountPoint) {
          return mountPoint;
        }
        const configFilePath = "/etc/wsl.conf";
        let isConfigFileExists = false;
        try {
          await fs.access(configFilePath, fsConstants.F_OK);
          isConfigFileExists = true;
        } catch {
        }
        if (!isConfigFileExists) {
          return defaultMountPoint;
        }
        const configContent = await fs.readFile(configFilePath, { encoding: "utf8" });
        const configMountPoint = /(?<!#.*)root\s*=\s*(?<mountPoint>.*)/g.exec(configContent);
        if (!configMountPoint) {
          return defaultMountPoint;
        }
        mountPoint = configMountPoint.groups.mountPoint.trim();
        mountPoint = mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`;
        return mountPoint;
      };
    })();
    var pTryEach = async (array, mapper) => {
      let latestError;
      for (const item of array) {
        try {
          return await mapper(item);
        } catch (error) {
          latestError = error;
        }
      }
      throw latestError;
    };
    var baseOpen = async (options) => {
      options = {
        wait: false,
        background: false,
        newInstance: false,
        allowNonzeroExitCode: false,
        ...options
      };
      if (Array.isArray(options.app)) {
        return pTryEach(options.app, (singleApp) => baseOpen({
          ...options,
          app: singleApp
        }));
      }
      let { name: app, arguments: appArguments = [] } = options.app || {};
      appArguments = [...appArguments];
      if (Array.isArray(app)) {
        return pTryEach(app, (appName) => baseOpen({
          ...options,
          app: {
            name: appName,
            arguments: appArguments
          }
        }));
      }
      let command;
      const cliArguments = [];
      const childProcessOptions = {};
      if (platform === "darwin") {
        command = "open";
        if (options.wait) {
          cliArguments.push("--wait-apps");
        }
        if (options.background) {
          cliArguments.push("--background");
        }
        if (options.newInstance) {
          cliArguments.push("--new");
        }
        if (app) {
          cliArguments.push("-a", app);
        }
      } else if (platform === "win32" || isWsl && !isDocker()) {
        const mountPoint = await getWslDrivesMountPoint();
        command = isWsl ? `${mountPoint}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` : `${process.env.SYSTEMROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell`;
        cliArguments.push(
          "-NoProfile",
          "-NonInteractive",
          "\u2013ExecutionPolicy",
          "Bypass",
          "-EncodedCommand"
        );
        if (!isWsl) {
          childProcessOptions.windowsVerbatimArguments = true;
        }
        const encodedArguments = ["Start"];
        if (options.wait) {
          encodedArguments.push("-Wait");
        }
        if (app) {
          encodedArguments.push(`"\`"${app}\`""`, "-ArgumentList");
          if (options.target) {
            appArguments.unshift(options.target);
          }
        } else if (options.target) {
          encodedArguments.push(`"${options.target}"`);
        }
        if (appArguments.length > 0) {
          appArguments = appArguments.map((arg) => `"\`"${arg}\`""`);
          encodedArguments.push(appArguments.join(","));
        }
        options.target = Buffer.from(encodedArguments.join(" "), "utf16le").toString("base64");
      } else {
        if (app) {
          command = app;
        } else {
          const isBundled = !__dirname || __dirname === "/";
          let exeLocalXdgOpen = false;
          try {
            await fs.access(localXdgOpenPath, fsConstants.X_OK);
            exeLocalXdgOpen = true;
          } catch {
          }
          const useSystemXdgOpen = process.versions.electron || platform === "android" || isBundled || !exeLocalXdgOpen;
          command = useSystemXdgOpen ? "xdg-open" : localXdgOpenPath;
        }
        if (appArguments.length > 0) {
          cliArguments.push(...appArguments);
        }
        if (!options.wait) {
          childProcessOptions.stdio = "ignore";
          childProcessOptions.detached = true;
        }
      }
      if (options.target) {
        cliArguments.push(options.target);
      }
      if (platform === "darwin" && appArguments.length > 0) {
        cliArguments.push("--args", ...appArguments);
      }
      const subprocess = childProcess.spawn(command, cliArguments, childProcessOptions);
      if (options.wait) {
        return new Promise((resolve, reject) => {
          subprocess.once("error", reject);
          subprocess.once("close", (exitCode) => {
            if (options.allowNonzeroExitCode && exitCode > 0) {
              reject(new Error(`Exited with code ${exitCode}`));
              return;
            }
            resolve(subprocess);
          });
        });
      }
      subprocess.unref();
      return subprocess;
    };
    var open2 = (target, options) => {
      if (typeof target !== "string") {
        throw new TypeError("Expected a `target`");
      }
      return baseOpen({
        ...options,
        target
      });
    };
    var openApp = (name, options) => {
      if (typeof name !== "string") {
        throw new TypeError("Expected a `name`");
      }
      const { arguments: appArguments = [] } = options || {};
      if (appArguments !== void 0 && appArguments !== null && !Array.isArray(appArguments)) {
        throw new TypeError("Expected `appArguments` as Array type");
      }
      return baseOpen({
        ...options,
        app: {
          name,
          arguments: appArguments
        }
      });
    };
    function detectArchBinary(binary) {
      if (typeof binary === "string" || Array.isArray(binary)) {
        return binary;
      }
      const { [arch]: archBinary } = binary;
      if (!archBinary) {
        throw new Error(`${arch} is not supported`);
      }
      return archBinary;
    }
    function detectPlatformBinary({ [platform]: platformBinary }, { wsl }) {
      if (wsl && isWsl) {
        return detectArchBinary(wsl);
      }
      if (!platformBinary) {
        throw new Error(`${platform} is not supported`);
      }
      return detectArchBinary(platformBinary);
    }
    var apps = {};
    defineLazyProperty(apps, "chrome", () => detectPlatformBinary({
      darwin: "google chrome",
      win32: "chrome",
      linux: ["google-chrome", "google-chrome-stable", "chromium"]
    }, {
      wsl: {
        ia32: "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        x64: ["/mnt/c/Program Files/Google/Chrome/Application/chrome.exe", "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"]
      }
    }));
    defineLazyProperty(apps, "firefox", () => detectPlatformBinary({
      darwin: "firefox",
      win32: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      linux: "firefox"
    }, {
      wsl: "/mnt/c/Program Files/Mozilla Firefox/firefox.exe"
    }));
    defineLazyProperty(apps, "edge", () => detectPlatformBinary({
      darwin: "microsoft edge",
      win32: "msedge",
      linux: ["microsoft-edge", "microsoft-edge-dev"]
    }, {
      wsl: "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    }));
    open2.apps = apps;
    open2.openApp = openApp;
    module.exports = open2;
  }
});

// src/util/config/files.ts
var import_load_json_file = __toESM(require_load_json_file(), 1);
var import_write_json_file = __toESM(require_write_json_file(), 1);
var import_client = __toESM(require_dist2(), 1);
import { join, basename, dirname } from "path";
import { accessSync, constants } from "fs";
var import_error_utils = __toESM(require_dist(), 1);
var VERCEL_DIR2 = global_path_default();
var CONFIG_FILE_PATH = join(VERCEL_DIR2, "config.json");
var AUTH_CONFIG_FILE_PATH = join(VERCEL_DIR2, "auth.json");
var readConfigFile = () => {
  const config = import_load_json_file.default.sync(CONFIG_FILE_PATH);
  return config;
};
var writeToConfigFile = (stuff) => {
  try {
    import_write_json_file.default.sync(CONFIG_FILE_PATH, stuff, { indent: 2 });
  } catch (err) {
    if ((0, import_error_utils.isErrnoException)(err)) {
      if ((0, import_error_utils.isErrnoException)(err) && err.code === "EPERM") {
        output_manager_default.error(
          `Not able to create ${highlight(
            CONFIG_FILE_PATH
          )} (operation not permitted).`
        );
        process.exit(1);
      } else if (err.code === "EBADF") {
        output_manager_default.error(
          `Not able to create ${highlight(
            CONFIG_FILE_PATH
          )} (bad file descriptor).`
        );
        process.exit(1);
      }
    }
    throw err;
  }
};
var readAuthConfigFile = () => {
  const config = import_load_json_file.default.sync(AUTH_CONFIG_FILE_PATH);
  return config;
};
var writeToAuthConfigFile = (authConfig) => {
  if (authConfig.skipWrite) {
    return;
  }
  try {
    return import_write_json_file.default.sync(AUTH_CONFIG_FILE_PATH, authConfig, {
      indent: 2,
      mode: 384
    });
  } catch (err) {
    if ((0, import_error_utils.isErrnoException)(err)) {
      if (err.code === "EPERM") {
        output_manager_default.error(
          `Not able to create ${highlight(
            AUTH_CONFIG_FILE_PATH
          )} (operation not permitted).`
        );
        process.exit(1);
      } else if (err.code === "EBADF") {
        output_manager_default.error(
          `Not able to create ${highlight(
            AUTH_CONFIG_FILE_PATH
          )} (bad file descriptor).`
        );
        process.exit(1);
      }
    }
    throw err;
  }
};
function getConfigFilePath() {
  return CONFIG_FILE_PATH;
}
function getAuthConfigFilePath() {
  return AUTH_CONFIG_FILE_PATH;
}
function readLocalConfig(prefix = process.cwd()) {
  let config = void 0;
  let target = "";
  try {
    target = getLocalPathConfig(prefix);
  } catch (err) {
    if (err instanceof NowError) {
      output_manager_default.error(err.message);
      process.exit(1);
    } else {
      throw err;
    }
  }
  if (!target) {
    return;
  }
  try {
    accessSync(target, constants.F_OK);
    config = import_load_json_file.default.sync(target);
  } catch (err) {
    if ((0, import_error_utils.isErrnoException)(err) && err.code === "ENOENT") {
    } else if ((0, import_error_utils.isError)(err) && err.name === "JSONError") {
      output_manager_default.error(err.message);
      process.exit(1);
    } else if ((0, import_error_utils.isErrnoException)(err)) {
      const code = err.code ? ` (${err.code})` : "";
      output_manager_default.error(`Failed to read config file: ${target}${code}`);
      process.exit(1);
    } else {
      output_manager_default.prettyError(err);
      process.exit(1);
    }
  }
  if (!config) {
    return;
  }
  const isCompiledConfig = basename(target) === "vercel.json" && basename(dirname(target)) === VERCEL_DIR;
  if (isCompiledConfig) {
    const workPath = dirname(dirname(target));
    let sourceFile = null;
    for (const ext of VERCEL_CONFIG_EXTENSIONS) {
      const configPath = join(workPath, `vercel.${ext}`);
      try {
        accessSync(configPath, constants.F_OK);
        sourceFile = basename(configPath);
        break;
      } catch {
      }
    }
    if (!sourceFile && isVercelTomlEnabled()) {
      const tomlPath = join(workPath, "vercel.toml");
      try {
        accessSync(tomlPath, constants.F_OK);
        sourceFile = "vercel.toml";
      } catch {
      }
    }
    config[import_client.fileNameSymbol] = sourceFile || DEFAULT_VERCEL_CONFIG_FILENAME;
  } else {
    config[import_client.fileNameSymbol] = basename(target);
  }
  return config;
}

// src/util/client.ts
var import_chalk5 = __toESM(require_source(), 1);

// ../../node_modules/.pnpm/@inquirer+confirm@3.1.2/node_modules/@inquirer/confirm/dist/esm/index.mjs
var esm_default4 = createPrompt((config, done) => {
  const { transformer = (answer) => answer ? "yes" : "no" } = config;
  const [status, setStatus] = useState("pending");
  const [value, setValue] = useState("");
  const theme = makeTheme(config.theme);
  const prefix = usePrefix({ theme });
  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      let answer = config.default !== false;
      if (/^(y|yes)/i.test(value))
        answer = true;
      else if (/^(n|no)/i.test(value))
        answer = false;
      setValue(transformer(answer));
      setStatus("done");
      done(answer);
    } else {
      setValue(rl.line);
    }
  });
  let formattedValue = value;
  let defaultValue = "";
  if (status === "done") {
    formattedValue = theme.style.answer(value);
  } else {
    defaultValue = ` ${theme.style.defaultAnswer(config.default === false ? "y/N" : "Y/n")}`;
  }
  const message = theme.style.message(config.message);
  return `${prefix} ${message}${defaultValue} ${formattedValue}`;
});

// ../../node_modules/.pnpm/@inquirer+expand@2.1.2/node_modules/@inquirer/expand/dist/esm/index.mjs
var import_chalk = __toESM(require_source2(), 1);
var helpChoice = {
  key: "h",
  name: "Help, list all options",
  value: void 0
};
function getChoiceKey(choice, key) {
  if (key === "name") {
    if ("name" in choice)
      return choice.name;
    return choice.value;
  }
  if ("value" in choice)
    return choice.value;
  return choice.name;
}
var esm_default5 = createPrompt((config, done) => {
  const { choices, default: defaultKey = "h", expanded: defaultExpandState = false } = config;
  const [status, setStatus] = useState("pending");
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(defaultExpandState);
  const [errorMsg, setError] = useState(void 0);
  const theme = makeTheme(config.theme);
  const prefix = usePrefix({ theme });
  useKeypress((event, rl) => {
    if (isEnterKey(event)) {
      const answer = (value || defaultKey).toLowerCase();
      if (answer === "h" && !expanded) {
        setExpanded(true);
      } else {
        const selectedChoice = choices.find(({ key }) => key === answer);
        if (selectedChoice) {
          const finalValue = getChoiceKey(selectedChoice, "value");
          setValue(finalValue);
          setStatus("done");
          done(finalValue);
        } else if (value === "") {
          setError("Please input a value");
        } else {
          setError(`"${import_chalk.default.red(value)}" isn't an available option`);
        }
      }
    } else {
      setValue(rl.line);
      setError(void 0);
    }
  });
  const message = theme.style.message(config.message);
  if (status === "done") {
    return `${prefix} ${message} ${theme.style.answer(value)}`;
  }
  const allChoices = expanded ? choices : [...choices, helpChoice];
  let longChoices = "";
  let shortChoices = allChoices.map((choice) => {
    if (choice.key === defaultKey) {
      return choice.key.toUpperCase();
    }
    return choice.key;
  }).join("");
  shortChoices = ` ${theme.style.defaultAnswer(shortChoices)}`;
  if (expanded) {
    shortChoices = "";
    longChoices = allChoices.map((choice) => {
      const line = `  ${choice.key}) ${getChoiceKey(choice, "name")}`;
      if (choice.key === value.toLowerCase()) {
        return theme.style.highlight(line);
      }
      return line;
    }).join("\n");
  }
  let helpTip = "";
  const currentOption = allChoices.find(({ key }) => key === value.toLowerCase());
  if (currentOption) {
    helpTip = `${import_chalk.default.cyan(">>")} ${getChoiceKey(currentOption, "name")}`;
  }
  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }
  return [
    `${prefix} ${message}${shortChoices} ${value}`,
    [longChoices, helpTip, error].filter(Boolean).join("\n")
  ];
});

// ../../node_modules/.pnpm/@inquirer+input@2.1.2/node_modules/@inquirer/input/dist/esm/index.mjs
var esm_default6 = createPrompt((config, done) => {
  const { validate = () => true } = config;
  const theme = makeTheme(config.theme);
  const [status, setStatus] = useState("pending");
  const [defaultValue = "", setDefaultValue] = useState(config.default);
  const [errorMsg, setError] = useState(void 0);
  const [value, setValue] = useState("");
  const isLoading = status === "loading";
  const prefix = usePrefix({ isLoading, theme });
  useKeypress(async (key, rl) => {
    if (status !== "pending") {
      return;
    }
    if (isEnterKey(key)) {
      const answer = value || defaultValue;
      setStatus("loading");
      const isValid = await validate(answer);
      if (isValid === true) {
        setValue(answer);
        setStatus("done");
        done(answer);
      } else {
        rl.write(value);
        setError(isValid || "You must provide a valid value");
        setStatus("pending");
      }
    } else if (isBackspaceKey(key) && !value) {
      setDefaultValue(void 0);
    } else if (key.name === "tab" && !value) {
      setDefaultValue(void 0);
      rl.clearLine(0);
      rl.write(defaultValue);
      setValue(defaultValue);
    } else {
      setValue(rl.line);
      setError(void 0);
    }
  });
  const message = theme.style.message(config.message);
  let formattedValue = value;
  if (typeof config.transformer === "function") {
    formattedValue = config.transformer(value, { isFinal: status === "done" });
  } else if (status === "done") {
    formattedValue = theme.style.answer(value);
  }
  let defaultStr;
  if (defaultValue && status !== "done" && !value) {
    defaultStr = theme.style.defaultAnswer(defaultValue);
  }
  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }
  return [
    [prefix, message, defaultStr, formattedValue].filter((v) => v !== void 0).join(" "),
    error
  ];
});

// ../../node_modules/.pnpm/@inquirer+password@2.1.2/node_modules/@inquirer/password/dist/esm/index.mjs
var import_ansi_escapes = __toESM(require_ansi_escapes(), 1);
var esm_default7 = createPrompt((config, done) => {
  const { validate = () => true } = config;
  const theme = makeTheme(config.theme);
  const [status, setStatus] = useState("pending");
  const [errorMsg, setError] = useState(void 0);
  const [value, setValue] = useState("");
  const isLoading = status === "loading";
  const prefix = usePrefix({ isLoading, theme });
  useKeypress(async (key, rl) => {
    if (status !== "pending") {
      return;
    }
    if (isEnterKey(key)) {
      const answer = value;
      setStatus("loading");
      const isValid = await validate(answer);
      if (isValid === true) {
        setValue(answer);
        setStatus("done");
        done(answer);
      } else {
        rl.write(value);
        setError(isValid || "You must provide a valid value");
        setStatus("pending");
      }
    } else {
      setValue(rl.line);
      setError(void 0);
    }
  });
  const message = theme.style.message(config.message);
  let formattedValue = "";
  let helpTip;
  if (config.mask) {
    const maskChar = typeof config.mask === "string" ? config.mask : "*";
    formattedValue = maskChar.repeat(value.length);
  } else if (status !== "done") {
    helpTip = `${theme.style.help("[input is masked]")}${import_ansi_escapes.default.cursorHide}`;
  }
  if (status === "done") {
    formattedValue = theme.style.answer(formattedValue);
  }
  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }
  return [[prefix, message, formattedValue, helpTip].filter(Boolean).join(" "), error];
});

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/key.mjs
var isEnterKey2 = (key) => key.name === "enter" || key.name === "return";

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/errors.mjs
var AbortPromptError = class extends Error {
  constructor(options) {
    super();
    __publicField(this, "name", "AbortPromptError");
    __publicField(this, "message", "Prompt was aborted");
    this.cause = options?.cause;
  }
};
var CancelPromptError = class extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "name", "CancelPromptError");
    __publicField(this, "message", "Prompt was canceled");
  }
};
var ExitPromptError = class extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "name", "ExitPromptError");
  }
};
var HookError = class extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "name", "HookError");
  }
};
var ValidationError = class extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "name", "ValidationError");
  }
};

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-prefix.mjs
import { AsyncResource as AsyncResource2 } from "async_hooks";

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/hook-engine.mjs
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
var hookStorage = new AsyncLocalStorage();
function createStore(rl) {
  const store = {
    rl,
    hooks: [],
    hooksCleanup: [],
    hooksEffect: [],
    index: 0,
    handleChange() {
    }
  };
  return store;
}
function withHooks(rl, cb) {
  const store = createStore(rl);
  return hookStorage.run(store, () => {
    function cycle(render) {
      store.handleChange = () => {
        store.index = 0;
        render();
      };
      store.handleChange();
    }
    return cb(cycle);
  });
}
function getStore() {
  const store = hookStorage.getStore();
  if (!store) {
    throw new HookError("[Inquirer] Hook functions can only be called from within a prompt");
  }
  return store;
}
function readline() {
  return getStore().rl;
}
function withUpdates(fn) {
  const wrapped = (...args) => {
    const store = getStore();
    let shouldUpdate = false;
    const oldHandleChange = store.handleChange;
    store.handleChange = () => {
      shouldUpdate = true;
    };
    const returnValue = fn(...args);
    if (shouldUpdate) {
      oldHandleChange();
    }
    store.handleChange = oldHandleChange;
    return returnValue;
  };
  return AsyncResource.bind(wrapped);
}
function withPointer(cb) {
  const store = getStore();
  const { index } = store;
  const pointer = {
    get() {
      return store.hooks[index];
    },
    set(value) {
      store.hooks[index] = value;
    },
    initialized: index in store.hooks
  };
  const returnValue = cb(pointer);
  store.index++;
  return returnValue;
}
function handleChange() {
  getStore().handleChange();
}
var effectScheduler = {
  queue(cb) {
    const store = getStore();
    const { index } = store;
    store.hooksEffect.push(() => {
      store.hooksCleanup[index]?.();
      const cleanFn = cb(readline());
      if (cleanFn != null && typeof cleanFn !== "function") {
        throw new ValidationError("useEffect return value must be a cleanup function or nothing.");
      }
      store.hooksCleanup[index] = cleanFn;
    });
  },
  run() {
    const store = getStore();
    withUpdates(() => {
      store.hooksEffect.forEach((effect) => {
        effect();
      });
      store.hooksEffect.length = 0;
    })();
  },
  clearAll() {
    const store = getStore();
    store.hooksCleanup.forEach((cleanFn) => {
      cleanFn?.();
    });
    store.hooksEffect.length = 0;
    store.hooksCleanup.length = 0;
  }
};

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-state.mjs
function useState2(defaultValue) {
  return withPointer((pointer) => {
    const setFn = (newValue) => {
      if (pointer.get() !== newValue) {
        pointer.set(newValue);
        handleChange();
      }
    };
    if (pointer.initialized) {
      return [pointer.get(), setFn];
    }
    const value = typeof defaultValue === "function" ? defaultValue() : defaultValue;
    pointer.set(value);
    return [value, setFn];
  });
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-effect.mjs
function useEffect(cb, depArray) {
  withPointer((pointer) => {
    const oldDeps = pointer.get();
    const hasChanged = !Array.isArray(oldDeps) || depArray.some((dep, i) => !Object.is(dep, oldDeps[i]));
    if (hasChanged) {
      effectScheduler.queue(cb);
    }
    pointer.set(depArray);
  });
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/theme.mjs
var import_yoctocolors_cjs = __toESM(require_yoctocolors_cjs(), 1);
var defaultTheme = {
  prefix: {
    idle: import_yoctocolors_cjs.default.blue("?"),
    // TODO: use figure
    done: import_yoctocolors_cjs.default.green(esm_default.tick)
  },
  spinner: {
    interval: 80,
    frames: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"].map((frame) => import_yoctocolors_cjs.default.yellow(frame))
  },
  style: {
    answer: import_yoctocolors_cjs.default.cyan,
    message: import_yoctocolors_cjs.default.bold,
    error: (text) => import_yoctocolors_cjs.default.red(`> ${text}`),
    defaultAnswer: (text) => import_yoctocolors_cjs.default.dim(`(${text})`),
    help: import_yoctocolors_cjs.default.dim,
    highlight: import_yoctocolors_cjs.default.cyan,
    key: (text) => import_yoctocolors_cjs.default.cyan(import_yoctocolors_cjs.default.bold(`<${text}>`))
  }
};

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/make-theme.mjs
function isPlainObject(value) {
  if (typeof value !== "object" || value === null)
    return false;
  let proto = value;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(value) === proto;
}
function deepMerge(...objects) {
  const output = {};
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const prevValue = output[key];
      output[key] = isPlainObject(prevValue) && isPlainObject(value) ? deepMerge(prevValue, value) : value;
    }
  }
  return output;
}
function makeTheme2(...themes) {
  const themesToMerge = [
    defaultTheme,
    ...themes.filter((theme) => theme != null)
  ];
  return deepMerge(...themesToMerge);
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-prefix.mjs
function usePrefix2({ status = "idle", theme }) {
  const [showLoader, setShowLoader] = useState2(false);
  const [tick, setTick] = useState2(0);
  const { prefix, spinner } = makeTheme2(theme);
  useEffect(() => {
    if (status === "loading") {
      let tickInterval;
      let inc = -1;
      const delayTimeout = setTimeout(AsyncResource2.bind(() => {
        setShowLoader(true);
        tickInterval = setInterval(AsyncResource2.bind(() => {
          inc = inc + 1;
          setTick(inc % spinner.frames.length);
        }), spinner.interval);
      }), 300);
      return () => {
        clearTimeout(delayTimeout);
        clearInterval(tickInterval);
      };
    } else {
      setShowLoader(false);
    }
  }, [status]);
  if (showLoader) {
    return spinner.frames[tick];
  }
  const iconName = status === "loading" ? "idle" : status;
  return typeof prefix === "string" ? prefix : prefix[iconName];
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-memo.mjs
function useMemo(fn, dependencies) {
  return withPointer((pointer) => {
    const prev = pointer.get();
    if (!prev || prev.dependencies.length !== dependencies.length || prev.dependencies.some((dep, i) => dep !== dependencies[i])) {
      const value = fn();
      pointer.set({ value, dependencies });
      return value;
    }
    return prev.value;
  });
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-ref.mjs
function useRef(val) {
  return useState2({ current: val })[0];
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/use-keypress.mjs
function useKeypress2(userHandler) {
  const signal = useRef(userHandler);
  signal.current = userHandler;
  useEffect((rl) => {
    let ignore = false;
    const handler = withUpdates((_input, event) => {
      if (ignore)
        return;
      void signal.current(event, rl);
    });
    rl.input.on("keypress", handler);
    return () => {
      ignore = true;
      rl.input.removeListener("keypress", handler);
    };
  }, []);
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/utils.mjs
var import_cli_width = __toESM(require_cli_width(), 1);
var import_wrap_ansi = __toESM(require_wrap_ansi(), 1);
function breakLines(content, width) {
  return content.split("\n").flatMap((line) => (0, import_wrap_ansi.default)(line, width, { trim: false, hard: true }).split("\n").map((str) => str.trimEnd())).join("\n");
}
function readlineWidth() {
  return (0, import_cli_width.default)({ defaultWidth: 80, output: readline().output });
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/pagination/lines.mjs
function split(content, width) {
  return breakLines(content, width).split("\n");
}
function rotate(count, items) {
  const max = items.length;
  const offset = (count % max + max) % max;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
function lines({ items, width, renderItem, active, position: requested, pageSize }) {
  const layouts = items.map((item, index) => ({
    item,
    index,
    isActive: index === active
  }));
  const layoutsInPage = rotate(active - requested, layouts).slice(0, pageSize);
  const renderItemAt = (index) => layoutsInPage[index] == null ? [] : split(renderItem(layoutsInPage[index]), width);
  const pageBuffer = Array.from({ length: pageSize });
  const activeItem = renderItemAt(requested).slice(0, pageSize);
  const position = requested + activeItem.length <= pageSize ? requested : pageSize - activeItem.length;
  pageBuffer.splice(position, activeItem.length, ...activeItem);
  let bufferPointer = position + activeItem.length;
  let layoutPointer = requested + 1;
  while (bufferPointer < pageSize && layoutPointer < layoutsInPage.length) {
    for (const line of renderItemAt(layoutPointer)) {
      pageBuffer[bufferPointer++] = line;
      if (bufferPointer >= pageSize)
        break;
    }
    layoutPointer++;
  }
  bufferPointer = position - 1;
  layoutPointer = requested - 1;
  while (bufferPointer >= 0 && layoutPointer >= 0) {
    for (const line of renderItemAt(layoutPointer).reverse()) {
      pageBuffer[bufferPointer--] = line;
      if (bufferPointer < 0)
        break;
    }
    layoutPointer--;
  }
  return pageBuffer.filter((line) => typeof line === "string");
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/pagination/position.mjs
function finite({ active, pageSize, total }) {
  const middle = Math.floor(pageSize / 2);
  if (total <= pageSize || active < middle)
    return active;
  if (active >= total - middle)
    return active + pageSize - total;
  return middle;
}
function infinite({ active, lastActive, total, pageSize, pointer }) {
  if (total <= pageSize)
    return active;
  if (lastActive < active && active - lastActive < pageSize) {
    return Math.min(Math.floor(pageSize / 2), pointer + active - lastActive);
  }
  return pointer;
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/pagination/use-pagination.mjs
function usePagination({ items, active, renderItem, pageSize, loop = true }) {
  const state = useRef({ position: 0, lastActive: 0 });
  const position = loop ? infinite({
    active,
    lastActive: state.current.lastActive,
    total: items.length,
    pageSize,
    pointer: state.current.position
  }) : finite({
    active,
    total: items.length,
    pageSize
  });
  state.current.position = position;
  state.current.lastActive = active;
  return lines({
    items,
    width: readlineWidth(),
    renderItem,
    active,
    position,
    pageSize
  }).join("\n");
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/create-prompt.mjs
var import_mute_stream = __toESM(require_lib(), 1);
import * as readline2 from "readline";
import { AsyncResource as AsyncResource3 } from "async_hooks";

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/screen-manager.mjs
var import_strip_ansi = __toESM(require_strip_ansi(), 1);
var import_ansi_escapes2 = __toESM(require_ansi_escapes(), 1);
var height = (content) => content.split("\n").length;
var lastLine = (content) => content.split("\n").pop() ?? "";
function cursorDown(n) {
  return n > 0 ? import_ansi_escapes2.default.cursorDown(n) : "";
}
var ScreenManager = class {
  constructor(rl) {
    __publicField(this, "rl");
    // These variables are keeping information to allow correct prompt re-rendering
    __publicField(this, "height", 0);
    __publicField(this, "extraLinesUnderPrompt", 0);
    __publicField(this, "cursorPos");
    this.rl = rl;
    this.rl = rl;
    this.cursorPos = rl.getCursorPos();
  }
  write(content) {
    this.rl.output.unmute();
    this.rl.output.write(content);
    this.rl.output.mute();
  }
  render(content, bottomContent = "") {
    const promptLine = lastLine(content);
    const rawPromptLine = (0, import_strip_ansi.default)(promptLine);
    let prompt = rawPromptLine;
    if (this.rl.line.length > 0) {
      prompt = prompt.slice(0, -this.rl.line.length);
    }
    this.rl.setPrompt(prompt);
    this.cursorPos = this.rl.getCursorPos();
    const width = readlineWidth();
    content = breakLines(content, width);
    bottomContent = breakLines(bottomContent, width);
    if (rawPromptLine.length % width === 0) {
      content += "\n";
    }
    let output = content + (bottomContent ? "\n" + bottomContent : "");
    const promptLineUpDiff = Math.floor(rawPromptLine.length / width) - this.cursorPos.rows;
    const bottomContentHeight = promptLineUpDiff + (bottomContent ? height(bottomContent) : 0);
    if (bottomContentHeight > 0)
      output += import_ansi_escapes2.default.cursorUp(bottomContentHeight);
    output += import_ansi_escapes2.default.cursorTo(this.cursorPos.cols);
    this.write(cursorDown(this.extraLinesUnderPrompt) + import_ansi_escapes2.default.eraseLines(this.height) + output);
    this.extraLinesUnderPrompt = bottomContentHeight;
    this.height = height(output);
  }
  checkCursorPos() {
    const cursorPos = this.rl.getCursorPos();
    if (cursorPos.cols !== this.cursorPos.cols) {
      this.write(import_ansi_escapes2.default.cursorTo(cursorPos.cols));
      this.cursorPos = cursorPos;
    }
  }
  done({ clearContent }) {
    this.rl.setPrompt("");
    let output = cursorDown(this.extraLinesUnderPrompt);
    output += clearContent ? import_ansi_escapes2.default.eraseLines(this.height) : "\n";
    output += import_ansi_escapes2.default.cursorShow;
    this.write(output);
    this.rl.close();
  }
};

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/promise-polyfill.mjs
var PromisePolyfill = class extends Promise {
  // Available starting from Node 22
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
  static withResolver() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
};

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/create-prompt.mjs
function createPrompt2(view) {
  const prompt = (config, context = {}) => {
    const { input = process.stdin, signal } = context;
    const cleanups = /* @__PURE__ */ new Set();
    const output = new import_mute_stream.default();
    output.pipe(context.output ?? process.stdout);
    const rl = readline2.createInterface({
      terminal: true,
      input,
      output
    });
    const screen = new ScreenManager(rl);
    const { promise, resolve, reject } = PromisePolyfill.withResolver();
    const cancel = () => reject(new CancelPromptError());
    if (signal) {
      const abort = () => reject(new AbortPromptError({ cause: signal.reason }));
      if (signal.aborted) {
        abort();
        return Object.assign(promise, { cancel });
      }
      signal.addEventListener("abort", abort);
      cleanups.add(() => signal.removeEventListener("abort", abort));
    }
    cleanups.add(onExit((code, signal2) => {
      reject(new ExitPromptError(`User force closed the prompt with ${code} ${signal2}`));
    }));
    const checkCursorPos = () => screen.checkCursorPos();
    rl.input.on("keypress", checkCursorPos);
    cleanups.add(() => rl.input.removeListener("keypress", checkCursorPos));
    return withHooks(rl, (cycle) => {
      const hooksCleanup = AsyncResource3.bind(() => effectScheduler.clearAll());
      rl.on("close", hooksCleanup);
      cleanups.add(() => rl.removeListener("close", hooksCleanup));
      cycle(() => {
        try {
          const nextView = view(config, (value) => {
            setImmediate(() => resolve(value));
          });
          const [content, bottomContent] = typeof nextView === "string" ? [nextView] : nextView;
          screen.render(content, bottomContent);
          effectScheduler.run();
        } catch (error) {
          reject(error);
        }
      });
      return Object.assign(promise.then((answer) => {
        effectScheduler.clearAll();
        return answer;
      }, (error) => {
        effectScheduler.clearAll();
        throw error;
      }).finally(() => {
        cleanups.forEach((cleanup) => cleanup());
        screen.done({ clearContent: Boolean(context?.clearPromptOnDone) });
        output.end();
      }).then(() => promise), { cancel });
    });
  };
  return prompt;
}

// ../../node_modules/.pnpm/@inquirer+core@9.2.1/node_modules/@inquirer/core/dist/esm/lib/Separator.mjs
var import_yoctocolors_cjs2 = __toESM(require_yoctocolors_cjs(), 1);
var Separator = class {
  constructor(separator) {
    __publicField(this, "separator", import_yoctocolors_cjs2.default.dim(Array.from({ length: 15 }).join(esm_default.line)));
    __publicField(this, "type", "separator");
    if (separator) {
      this.separator = separator;
    }
  }
  static isSeparator(choice) {
    return Boolean(choice && typeof choice === "object" && "type" in choice && choice.type === "separator");
  }
};

// ../../node_modules/.pnpm/@inquirer+search@2.0.1/node_modules/@inquirer/search/dist/esm/index.mjs
var import_yoctocolors_cjs3 = __toESM(require_yoctocolors_cjs(), 1);
var searchTheme = {
  icon: { cursor: esm_default.pointer },
  style: {
    disabled: (text) => import_yoctocolors_cjs3.default.dim(`- ${text}`),
    searchTerm: (text) => import_yoctocolors_cjs3.default.cyan(text),
    description: (text) => import_yoctocolors_cjs3.default.cyan(text)
  },
  helpMode: "auto"
};
function isSelectable(item) {
  return !Separator.isSeparator(item) && !item.disabled;
}
function normalizeChoices(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice))
      return choice;
    if (typeof choice === "string") {
      return {
        value: choice,
        name: choice,
        short: choice,
        disabled: false
      };
    }
    const name = choice.name ?? String(choice.value);
    return {
      value: choice.value,
      name,
      description: choice.description,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false
    };
  });
}
var esm_default8 = createPrompt2((config, done) => {
  const { pageSize = 7, validate = () => true } = config;
  const theme = makeTheme2(searchTheme, config.theme);
  const firstRender = useRef(true);
  const [status, setStatus] = useState2("loading");
  const [searchTerm, setSearchTerm] = useState2("");
  const [searchResults, setSearchResults] = useState2([]);
  const [searchError, setSearchError] = useState2();
  const prefix = usePrefix2({ status, theme });
  const bounds = useMemo(() => {
    const first = searchResults.findIndex(isSelectable);
    const last = searchResults.findLastIndex(isSelectable);
    return { first, last };
  }, [searchResults]);
  const [active = bounds.first, setActive] = useState2();
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setSearchError(void 0);
    const fetchResults = async () => {
      try {
        const results = await config.source(searchTerm || void 0, {
          signal: controller.signal
        });
        if (!controller.signal.aborted) {
          setActive(void 0);
          setSearchError(void 0);
          setSearchResults(normalizeChoices(results));
          setStatus("idle");
        }
      } catch (error2) {
        if (!controller.signal.aborted && error2 instanceof Error) {
          setSearchError(error2.message);
        }
      }
    };
    void fetchResults();
    return () => {
      controller.abort();
    };
  }, [searchTerm]);
  const selectedChoice = searchResults[active];
  useKeypress2(async (key, rl) => {
    if (isEnterKey2(key)) {
      if (selectedChoice) {
        setStatus("loading");
        const isValid = await validate(selectedChoice.value);
        setStatus("idle");
        if (isValid === true) {
          setStatus("done");
          done(selectedChoice.value);
        } else if (selectedChoice.name === searchTerm) {
          setSearchError(isValid || "You must provide a valid value");
        } else {
          rl.write(selectedChoice.name);
          setSearchTerm(selectedChoice.name);
        }
      } else {
        rl.write(searchTerm);
      }
    } else if (key.name === "tab" && selectedChoice) {
      rl.clearLine(0);
      rl.write(selectedChoice.name);
      setSearchTerm(selectedChoice.name);
    } else if (status !== "loading" && (key.name === "up" || key.name === "down")) {
      rl.clearLine(0);
      if (key.name === "up" && active !== bounds.first || key.name === "down" && active !== bounds.last) {
        const offset = key.name === "up" ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + searchResults.length) % searchResults.length;
        } while (!isSelectable(searchResults[next]));
        setActive(next);
      }
    } else {
      setSearchTerm(rl.line);
    }
  });
  const message = theme.style.message(config.message, status);
  if (active > 0) {
    firstRender.current = false;
  }
  let helpTip = "";
  if (searchResults.length > 1 && (theme.helpMode === "always" || theme.helpMode === "auto" && firstRender.current)) {
    helpTip = searchResults.length > pageSize ? `
${theme.style.help("(Use arrow keys to reveal more choices)")}` : `
${theme.style.help("(Use arrow keys)")}`;
  }
  const page = usePagination({
    items: searchResults,
    active,
    renderItem({ item, isActive }) {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        return theme.style.disabled(`${item.name} ${disabledLabel}`);
      }
      const color = isActive ? theme.style.highlight : (x) => x;
      const cursor = isActive ? theme.icon.cursor : ` `;
      return color(`${cursor} ${item.name}`);
    },
    pageSize,
    loop: false
  });
  let error;
  if (searchError) {
    error = theme.style.error(searchError);
  } else if (searchResults.length === 0 && searchTerm !== "" && status === "idle") {
    error = theme.style.error("No results found");
  }
  let searchStr;
  if (status === "done" && selectedChoice) {
    const answer = selectedChoice.short ?? selectedChoice.name;
    return `${prefix} ${message} ${theme.style.answer(answer)}`;
  } else {
    searchStr = theme.style.searchTerm(searchTerm);
  }
  const choiceDescription = selectedChoice?.description ? `
${theme.style.description(selectedChoice.description)}` : ``;
  return [
    [prefix, message, searchStr].filter(Boolean).join(" "),
    `${error ?? page}${helpTip}${choiceDescription}`
  ];
});

// src/util/client.ts
var import_async_retry = __toESM(require_dist3(), 1);
var import_node_fetch2 = __toESM(require_lib2(), 1);
import { EventEmitter } from "events";
import { URL as URL2 } from "url";

// src/util/response-error.ts
async function responseError(res, fallbackMessage = null, parsedBody = {}) {
  let bodyError;
  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch (_err) {
      body = parsedBody;
    }
    bodyError = body.error || body.err || body;
  }
  const msg = bodyError?.message || fallbackMessage || "Response Error";
  return new APIError(msg, res, bodyError);
}

// src/util/print-indications.ts
var import_chalk2 = __toESM(require_source(), 1);
function printIndications(res) {
  const indications = /* @__PURE__ */ new Set(["warning", "notice", "tip"]);
  const regex = /^x-(?:vercel|now)-(warning|notice|tip)-(.*)$/;
  for (const [name, payload] of res.headers) {
    const match = name.match(regex);
    if (match) {
      const [, type, identifier] = match;
      const action = res.headers.get(`x-vercel-action-${identifier}`);
      const link = res.headers.get(`x-vercel-link-${identifier}`);
      if (indications.has(type)) {
        const newline = "\n";
        const message = prependEmoji(import_chalk2.default.dim(payload), emoji(type)) + newline;
        let finalLink = "";
        if (link) {
          finalLink = import_chalk2.default.dim(`${action || "Learn More"}: ${link_default(link)}`) + newline;
        }
        output_manager_default.print(message + finalLink);
      }
    }
  }
}

// src/util/login/reauthenticate.ts
var import_chalk4 = __toESM(require_source(), 1);

// src/commands/login/future.ts
var import_chalk3 = __toESM(require_source(), 1);
var open = __toESM(require_open(), 1);
var import_ansi_escapes3 = __toESM(require_ansi_escapes(), 1);
import readline3 from "readline";
import { KNOWN_AGENTS } from "@vercel/detect-agent";

// src/util/login/update-current-team-after-login.ts
async function updateCurrentTeamAfterLogin(client, ssoTeamId) {
  if (ssoTeamId) {
    client.config.currentTeam = ssoTeamId;
  } else {
    let user = null;
    try {
      user = await getUser(client);
    } catch (_err) {
      output_manager_default.error("Failed to fetch the logged in user. Please try again.");
      return 1;
    }
    if (user.version === "northstar" && user.defaultTeamId) {
      client.config.currentTeam = user.defaultTeamId;
    } else {
      delete client.config.currentTeam;
    }
  }
}

// src/util/oauth.ts
var import_node_fetch = __toESM(require_lib2(), 1);
import { hostname } from "os";
var VERCEL_ISSUER = new URL("https://vercel.com");
var VERCEL_CLI_CLIENT_ID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp";
var userAgent = `${hostname()} @ ${ua_default}`;
var _as;
async function as() {
  if (!_as) {
    const discoveryResponse = await discoveryEndpointRequest(VERCEL_ISSUER);
    const [discoveryResponseError, as2] = await processDiscoveryEndpointResponse(discoveryResponse);
    if (discoveryResponseError) {
      throw discoveryResponseError;
    }
    _as = as2;
  }
  return _as;
}
async function discoveryEndpointRequest(issuer) {
  return await (0, import_node_fetch.default)(new URL(".well-known/openid-configuration", issuer), {
    headers: { "Content-Type": "application/json", "user-agent": userAgent }
  });
}
async function processDiscoveryEndpointResponse(response) {
  const json = await response.json();
  if (!response.ok) {
    return [new Error("Discovery endpoint request failed")];
  }
  if (typeof json !== "object" || json === null || !canParseURL(json.issuer) || !canParseURL(json.device_authorization_endpoint) || !canParseURL(json.token_endpoint) || !canParseURL(json.revocation_endpoint) || !canParseURL(json.jwks_uri) || !canParseURL(json.introspection_endpoint)) {
    return [new TypeError("Invalid discovery response")];
  }
  const issuer = new URL(json.issuer);
  if (issuer.href !== VERCEL_ISSUER.href) {
    return [new Error("Issuer mismatch")];
  }
  return [
    null,
    {
      issuer,
      device_authorization_endpoint: new URL(
        json.device_authorization_endpoint
      ),
      token_endpoint: new URL(json.token_endpoint),
      revocation_endpoint: new URL(json.revocation_endpoint),
      jwks_uri: new URL(json.jwks_uri),
      introspection_endpoint: new URL(json.introspection_endpoint)
    }
  ];
}
async function deviceAuthorizationRequest() {
  return await (0, import_node_fetch.default)((await as()).device_authorization_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "user-agent": userAgent
    },
    body: new URLSearchParams({
      client_id: VERCEL_CLI_CLIENT_ID,
      scope: "openid offline_access"
    })
  });
}
async function processDeviceAuthorizationResponse(response) {
  const json = await response.json();
  if (!response.ok) {
    return [new OAuthError("Device authorization request failed", json)];
  }
  if (typeof json !== "object" || json === null)
    return [new TypeError("Expected response to be an object")];
  if (!("device_code" in json) || typeof json.device_code !== "string")
    return [new TypeError("Expected `device_code` to be a string")];
  if (!("user_code" in json) || typeof json.user_code !== "string")
    return [new TypeError("Expected `user_code` to be a string")];
  if (!("verification_uri" in json) || typeof json.verification_uri !== "string" || !canParseURL(json.verification_uri)) {
    return [new TypeError("Expected `verification_uri` to be a string")];
  }
  if (!("verification_uri_complete" in json) || typeof json.verification_uri_complete !== "string" || !canParseURL(json.verification_uri_complete)) {
    return [
      new TypeError("Expected `verification_uri_complete` to be a string")
    ];
  }
  if (!("expires_in" in json) || typeof json.expires_in !== "number")
    return [new TypeError("Expected `expires_in` to be a number")];
  if (!("interval" in json) || typeof json.interval !== "number")
    return [new TypeError("Expected `interval` to be a number")];
  return [
    null,
    {
      device_code: json.device_code,
      user_code: json.user_code,
      verification_uri: json.verification_uri,
      verification_uri_complete: json.verification_uri_complete,
      expiresAt: Date.now() + json.expires_in * 1e3,
      interval: json.interval
    }
  ];
}
async function deviceAccessTokenRequest(options) {
  try {
    return [
      null,
      await (0, import_node_fetch.default)((await as()).token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "user-agent": userAgent
        },
        body: new URLSearchParams({
          client_id: VERCEL_CLI_CLIENT_ID,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          ...options
        }),
        // TODO: Drop `node-fetch` and just use `signal`
        timeout: 10 * 1e3,
        // @ts-expect-error: Signal is part of `fetch` spec, should drop `node-fetch`
        signal: AbortSignal.timeout(10 * 1e3)
      })
    ];
  } catch (error) {
    if (error instanceof Error)
      return [error];
    return [
      new Error("An unknown error occurred. See the logs for details.", {
        cause: error
      })
    ];
  }
}
async function processTokenResponse(response) {
  const json = await response.json();
  if (!response.ok) {
    return [new OAuthError("Device access token request failed", json)];
  }
  if (typeof json !== "object" || json === null)
    return [new TypeError("Expected response to be an object")];
  if (!("access_token" in json) || typeof json.access_token !== "string")
    return [new TypeError("Expected `access_token` to be a string")];
  if (!("token_type" in json) || json.token_type !== "Bearer")
    return [new TypeError('Expected `token_type` to be "Bearer"')];
  if (!("expires_in" in json) || typeof json.expires_in !== "number")
    return [new TypeError("Expected `expires_in` to be a number")];
  if ("refresh_token" in json && (typeof json.refresh_token !== "string" || !json.refresh_token))
    return [new TypeError("Expected `refresh_token` to be a string")];
  if ("scope" in json && typeof json.scope !== "string")
    return [new TypeError("Expected `scope` to be a string")];
  return [null, json];
}
async function revocationRequest(options) {
  return await (0, import_node_fetch.default)((await as()).revocation_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "user-agent": userAgent
    },
    body: new URLSearchParams({ ...options, client_id: VERCEL_CLI_CLIENT_ID })
  });
}
async function processRevocationResponse(response) {
  if (response.ok)
    return [null, null];
  const json = await response.json();
  return [new OAuthError("Revocation request failed", json)];
}
async function refreshTokenRequest(options) {
  return await (0, import_node_fetch.default)((await as()).token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "user-agent": userAgent
    },
    body: new URLSearchParams({
      client_id: VERCEL_CLI_CLIENT_ID,
      grant_type: "refresh_token",
      ...options
    })
  });
}
function processOAuthErrorResponse(json) {
  if (typeof json !== "object" || json === null)
    return new TypeError("Expected response to be an object");
  if (!("error" in json) || typeof json.error !== "string")
    return new TypeError("Expected `error` to be a string");
  if ("error_description" in json && typeof json.error_description !== "string")
    return new TypeError("Expected `error_description` to be a string");
  if ("error_uri" in json && typeof json.error_uri !== "string")
    return new TypeError("Expected `error_uri` to be a string");
  return json;
}
var OAuthError = class extends Error {
  constructor(message, response) {
    var __super = (...args) => {
      super(...args);
    };
    const error = processOAuthErrorResponse(response);
    if (error instanceof TypeError) {
      const message2 = `Unexpected server response: ${JSON.stringify(response)}`;
      __super(message2);
      this.cause = new Error(message2, { cause: error });
      this.code = "server_error";
      return;
    }
    let cause = error.error;
    if (error.error_description)
      cause += `: ${error.error_description}`;
    if (error.error_uri)
      cause += ` (${error.error_uri})`;
    __super(message, { cause });
    this.cause = new Error(cause);
    this.code = error.error;
  }
};
function isOAuthError(error) {
  return error instanceof OAuthError;
}
function canParseURL(url) {
  try {
    return !!new URL(url);
  } catch {
    return false;
  }
}

// src/commands/login/future.ts
async function performDeviceCodeFlow(client, options) {
  const deviceAuthorizationResponse = await deviceAuthorizationRequest();
  output_manager_default.debug(
    `'Device Authorization response:', ${await deviceAuthorizationResponse.clone().text()}`
  );
  const [deviceAuthorizationError, deviceAuthorization] = await processDeviceAuthorizationResponse(deviceAuthorizationResponse);
  if (deviceAuthorizationError) {
    printError(deviceAuthorizationError);
    return null;
  }
  const { device_code, user_code, verification_uri, expiresAt, interval } = deviceAuthorization;
  let { verification_uri_complete } = deviceAuthorization;
  if (options?.teamId) {
    const url = new URL(verification_uri_complete);
    url.searchParams.set("team_id", options.teamId);
    verification_uri_complete = url.toString();
  }
  const isCursorAgent = client.agentName === KNOWN_AGENTS.CURSOR || client.agentName === KNOWN_AGENTS.CURSOR_CLI;
  const shouldSkipBrowser = process.env.CI && !isCursorAgent;
  output_manager_default.log(
    `
  Visit ${import_chalk3.default.bold(
      output_manager_default.link(
        verification_uri.replace("https://", ""),
        verification_uri_complete,
        { color: false, fallback: () => verification_uri_complete }
      )
    )}${output_manager_default.supportsHyperlink ? ` and enter ${import_chalk3.default.bold(user_code)}` : ""}
`
  );
  if (!shouldSkipBrowser) {
    try {
      const browserProcess = await open.default(verification_uri_complete);
      browserProcess.on("error", (error) => {
        output_manager_default.debug(`Failed to open browser: ${error}`);
      });
    } catch (error) {
      output_manager_default.debug(`Failed to open browser: ${error}`);
      if (client.isAgent && client.nonInteractive) {
        output_manager_default.log(
          `
${import_chalk3.default.yellow("\u26A0")} ${import_chalk3.default.bold("Browser could not be opened automatically.")}
`
        );
        output_manager_default.log(
          `Please ask the user to manually visit the URL above and complete the authentication process.
`
        );
      }
    }
  }
  const rl = readline3.createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", () => {
    process.exit(0);
  });
  output_manager_default.spinner("Waiting for authentication...");
  let intervalMs = interval * 1e3;
  let result = null;
  let flowError = new Error(
    "Timed out waiting for authentication. Please try again."
  );
  async function pollForToken() {
    while (Date.now() < expiresAt) {
      const [tokenResponseError, tokenResponse] = await deviceAccessTokenRequest({ device_code });
      if (tokenResponseError) {
        if (tokenResponseError.message.includes("timeout")) {
          intervalMs *= 2;
          output_manager_default.debug(
            `Connection timeout. Slowing down, polling every ${intervalMs / 1e3}s...`
          );
          await wait(intervalMs);
          continue;
        }
        return tokenResponseError;
      }
      output_manager_default.debug(
        `'Device Access Token response:', ${await tokenResponse.clone().text()}`
      );
      const [tokensError, tokens] = await processTokenResponse(tokenResponse);
      if (isOAuthError(tokensError)) {
        const { code } = tokensError;
        switch (code) {
          case "authorization_pending":
            await wait(intervalMs);
            continue;
          case "slow_down":
            intervalMs += 5 * 1e3;
            output_manager_default.debug(
              `Authorization server requests to slow down. Polling every ${intervalMs / 1e3}s...`
            );
            await wait(intervalMs);
            continue;
          default:
            return tokensError.cause;
        }
      }
      if (tokensError)
        return tokensError;
      output_manager_default.print((0, import_ansi_escapes3.eraseLines)(2));
      result = {
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token
      };
      return;
    }
  }
  flowError = await pollForToken();
  output_manager_default.stopSpinner();
  rl.close();
  if (flowError) {
    printError(flowError);
    return null;
  }
  return result;
}
async function login(client, telemetry) {
  const tokens = await performDeviceCodeFlow(client);
  if (!tokens) {
    telemetry.trackState("error");
    return 1;
  }
  const isInitialLogin = !client.authConfig.token;
  client.updateAuthConfig({
    token: tokens.access_token,
    userId: void 0,
    expiresAt: Math.floor(Date.now() / 1e3) + tokens.expires_in,
    refreshToken: tokens.refresh_token
  });
  client.updateConfig({ currentTeam: void 0 });
  if (isInitialLogin) {
    await updateCurrentTeamAfterLogin(client);
  }
  client.writeToAuthConfigFile();
  client.writeToConfigFile();
  output_manager_default.debug(`Saved credentials in "${humanizePath(global_path_default())}"`);
  output_manager_default.print(`
  ${import_chalk3.default.cyan("Congratulations!")} You are now signed in.

  To deploy something, run ${getCommandName()}.

  ${emoji("tip")} To deploy every commit automatically,
  connect a Git Repository (${import_chalk3.default.bold(output_manager_default.link("vercel.link/git", "https://vercel.link/git", { color: false }))}).
`);
  telemetry.trackState("success");
  await autoInstallVercelPlugin(client);
  return 0;
}
async function wait(intervalMs) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

// src/util/login/reauthenticate.ts
async function reauthenticate(client, error) {
  if (error.teamId && error.enforced) {
    output_manager_default.log(
      `You must re-authenticate with SAML to use ${(0, import_chalk4.bold)(error.scope)} scope.`
    );
  } else {
    output_manager_default.log(`You must re-authenticate to use ${(0, import_chalk4.bold)(error.scope)} scope.`);
  }
  const tokens = await performDeviceCodeFlow(client, {
    teamId: error.teamId || void 0
  });
  if (!tokens) {
    return 1;
  }
  client.updateAuthConfig({
    token: tokens.access_token,
    userId: void 0,
    expiresAt: Math.floor(Date.now() / 1e3) + tokens.expires_in,
    refreshToken: tokens.refresh_token
  });
  client.writeToAuthConfigFile();
  output_manager_default.success(`Authentication complete for ${(0, import_chalk4.bold)(error.scope)} scope.`);
  return { token: tokens.access_token, email: "" };
}

// src/util/promise.ts
function sharedPromise(fn) {
  let promise = null;
  return function(...args) {
    if (!promise) {
      promise = fn.apply(this, args);
      promise.finally(() => {
        promise = null;
      });
    }
    return promise;
  };
}

// src/util/client.ts
var import_error_utils2 = __toESM(require_dist(), 1);

// src/util/sleep.ts
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// src/util/client.ts
var isSAMLError = (v) => {
  return v && v.saml;
};
var isJSONObject = (v) => {
  return v && typeof v == "object" && v.constructor === Object;
};
function isValidAccessToken(authConfig) {
  if (!authConfig.token)
    return false;
  if (typeof authConfig.expiresAt !== "number")
    return true;
  const nowInSeconds = Math.floor(Date.now() / 1e3);
  return authConfig.expiresAt >= nowInSeconds;
}
function hasRefreshToken(authConfig) {
  return "refreshToken" in authConfig;
}
var Client = class extends EventEmitter {
  constructor(opts) {
    super();
    /** Track if we've already logged the token source debug message */
    this._loggedTokenSource = false;
    this.reauthenticate = sharedPromise(async function(error) {
      const result = await reauthenticate(this, error);
      if (typeof result === "number") {
        if (error instanceof APIError) {
          output_manager_default.prettyError(error);
        } else {
          output_manager_default.error(
            `Failed to re-authenticate for ${(0, import_chalk5.bold)(error.scope)} scope`
          );
        }
        throw error;
      }
    });
    this._onRetry = (error) => {
      output_manager_default.debug(`Retrying: ${error}
${error.stack}`);
    };
    this.agent = opts.agent;
    this.argv = opts.argv;
    this.apiUrl = opts.apiUrl;
    this.authConfig = opts.authConfig;
    this.stdin = opts.stdin;
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.config = opts.config;
    this.localConfig = opts.localConfig;
    this.localConfigPath = opts.localConfigPath;
    this.requestIdCounter = 1;
    this.telemetryEventStore = opts.telemetryEventStore;
    this.isAgent = opts.isAgent ?? false;
    this.agentName = opts.agentName;
    this.nonInteractive = opts.nonInteractive ?? this.isAgent;
    this.dangerouslySkipPermissions = opts.dangerouslySkipPermissions ?? false;
    const theme = {
      prefix: (0, import_chalk5.gray)("?"),
      style: { answer: import_chalk5.gray }
    };
    this.input = {
      text: (opts2) => esm_default6({ theme, ...opts2 }, { input: this.stdin, output: this.stderr }),
      password: (opts2) => esm_default7(
        { theme, ...opts2 },
        { input: this.stdin, output: this.stderr }
      ),
      checkbox: (opts2) => esm_default2(
        { theme, ...opts2 },
        { input: this.stdin, output: this.stderr }
      ),
      expand: (opts2) => esm_default5({ theme, ...opts2 }, { input: this.stdin, output: this.stderr }),
      confirm: (message, default_value) => esm_default4(
        { theme, message, default: default_value },
        { input: this.stdin, output: this.stderr }
      ),
      select: (opts2) => esm_default3(
        { theme, ...opts2 },
        { input: this.stdin, output: this.stderr }
      ),
      search: (opts2) => esm_default8(
        { theme, ...opts2 },
        { input: this.stdin, output: this.stderr }
      )
    };
  }
  retry(fn, { retries = 3, maxTimeout = Infinity } = {}) {
    return (0, import_async_retry.default)(fn, {
      retries,
      maxTimeout,
      onRetry: this._onRetry
    });
  }
  /**
   * This method silently tries to refresh the access_token if it is expired.
   *
   * If the refresh_token is also expired, it will not attempt to refresh it.
   * If there is any error during the refresh process, it will not throw an error.
   */
  async ensureAuthorized() {
    const { authConfig } = this;
    if (isValidAccessToken(authConfig)) {
      if (!this._loggedTokenSource) {
        if (authConfig.tokenSource === "flag") {
          output_manager_default.debug(
            "Using token from `--token` argument, skipping token refresh."
          );
        } else if (authConfig.tokenSource === "env") {
          output_manager_default.debug(
            "Using token from VERCEL_TOKEN environment variable, skipping token refresh."
          );
        } else {
          output_manager_default.debug("Valid access token, skipping token refresh.");
        }
        this._loggedTokenSource = true;
      }
      return;
    }
    if (!hasRefreshToken(authConfig)) {
      output_manager_default.debug("No refresh token found, emptying auth config.");
      this.emptyAuthConfig();
      this.writeToAuthConfigFile();
      return;
    }
    const tokenResponse = await refreshTokenRequest({
      refresh_token: authConfig.refreshToken
    });
    const [tokensError, tokens] = await processTokenResponse(tokenResponse);
    if (tokensError) {
      output_manager_default.debug("Error refreshing token, emptying auth config.");
      this.emptyAuthConfig();
      this.writeToAuthConfigFile();
      return;
    }
    this.updateAuthConfig({
      token: tokens.access_token,
      expiresAt: Math.floor(Date.now() / 1e3) + tokens.expires_in
    });
    if (tokens.refresh_token) {
      this.updateAuthConfig({ refreshToken: tokens.refresh_token });
    }
    this.writeToAuthConfigFile();
    this.writeToConfigFile();
    output_manager_default.debug("Tokens refreshed successfully.");
  }
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
  writeToConfigFile() {
    writeToConfigFile(this.config);
  }
  updateAuthConfig(authConfig) {
    this.authConfig = { ...this.authConfig, ...authConfig };
  }
  emptyAuthConfig() {
    this.authConfig = this.authConfig.skipWrite ? { skipWrite: true } : {};
  }
  writeToAuthConfigFile() {
    writeToAuthConfigFile(this.authConfig);
  }
  /**
   * Confirms DELETE operations with the user.
   *
   * - DELETE operations always require confirmation (unless --dangerously-skip-permissions is used)
   * - When running under an AI agent with --dangerously-skip-permissions,
   *   a warning is displayed for visibility
   *
   * @returns true if the operation should proceed, false if canceled
   */
  async confirmMutatingOperation(url, method) {
    const normalizedMethod = (method || "GET").toUpperCase();
    const isDelete = normalizedMethod === "DELETE";
    if (!isDelete) {
      return true;
    }
    if (this.isAgent && this.dangerouslySkipPermissions) {
      const agentInfo = this.agentName ? ` (${this.agentName})` : "";
      output_manager_default.print("\n");
      output_manager_default.print(
        (0, import_chalk5.bgRed)((0, import_chalk5.white)((0, import_chalk5.bold)(" \u26A0 WARNING "))) + (0, import_chalk5.red)((0, import_chalk5.bold)(" AGENT MODE - DELETE CONFIRMATION BYPASSED\n"))
      );
      output_manager_default.print(
        (0, import_chalk5.yellow)(
          `  An AI agent${agentInfo} is executing a ${(0, import_chalk5.bold)("DELETE")} request with --dangerously-skip-permissions flag.
`
        )
      );
      output_manager_default.print((0, import_chalk5.yellow)(`  This operation will delete data: ${(0, import_chalk5.bold)(url)}
`));
      output_manager_default.print(
        (0, import_chalk5.yellow)(
          `  The --dangerously-skip-permissions flag has bypassed the confirmation prompt.

`
        )
      );
    }
    if (this.dangerouslySkipPermissions) {
      return true;
    }
    if (!this.stdin.isTTY) {
      output_manager_default.error(
        `DELETE operations require confirmation. Use ${(0, import_chalk5.bold)("--dangerously-skip-permissions")} to skip confirmation in non-interactive mode.`
      );
      return false;
    }
    const message = `You are about to perform a ${(0, import_chalk5.red)((0, import_chalk5.bold)("DELETE"))} operation on:
  ${(0, import_chalk5.bold)(url)}

Are you sure you want to proceed?`;
    output_manager_default.print("\n");
    const confirmed = await this.input.confirm(message, false);
    output_manager_default.print("\n");
    if (!confirmed) {
      output_manager_default.log("Operation canceled by user.");
    }
    return confirmed;
  }
  async _fetch(_url, opts = {}) {
    const url = new URL2(_url, this.apiUrl);
    if (opts.accountId || opts.useCurrentTeam !== false) {
      if (opts.accountId) {
        if (opts.accountId.startsWith("team_")) {
          url.searchParams.set("teamId", opts.accountId);
        } else {
          url.searchParams.delete("teamId");
        }
      } else if (opts.useCurrentTeam !== false && this.config.currentTeam && !url.searchParams.has("teamId")) {
        url.searchParams.set("teamId", this.config.currentTeam);
      }
    }
    const headers = new import_node_fetch2.Headers(opts.headers);
    headers.set("user-agent", ua_default);
    if (this.agentName) {
      headers.set("x-ai-agent", this.agentName);
    }
    await this.ensureAuthorized();
    if (this.authConfig.token) {
      headers.set("authorization", `Bearer ${this.authConfig.token}`);
    }
    let body;
    if (isJSONObject(opts.body)) {
      body = JSON.stringify(opts.body);
      headers.set("content-type", "application/json; charset=utf-8");
    } else {
      body = opts.body;
    }
    const requestId = this.requestIdCounter++;
    return output_manager_default.time(
      (res) => {
        if (res) {
          return `#${requestId} \u2190 ${res.status} ${res.statusText}: ${res.headers.get("x-vercel-id")}`;
        } else {
          return `#${requestId} \u2192 ${opts.method || "GET"} ${url.href}`;
        }
      },
      (0, import_node_fetch2.default)(url, { agent: this.agent, ...opts, headers, body })
    );
  }
  fetch(url, opts = {}) {
    return this.retry(async (bail) => {
      const res = await this._fetch(url, opts);
      printIndications(res);
      if (!res.ok) {
        if (opts.redirect === "manual" && res.status >= 300 && res.status < 400) {
          return res;
        }
        const error = await responseError(res);
        if (isSAMLError(error) && error.teamId) {
          try {
            await this.reauthenticate(error);
          } catch (reauthError) {
            return bail((0, import_error_utils2.normalizeError)(reauthError));
          }
        } else if (res.status === 429 && opts.bailOn429) {
          return bail(error);
        } else if (typeof error.retryAfterMs === "number") {
          const randomSkewMs = 3e4 * Math.random();
          await sleep(error.retryAfterMs + randomSkewMs);
        } else if (res.status >= 400 && res.status < 500) {
          return bail(error);
        }
        throw error;
      }
      if (opts.json === false) {
        return res;
      }
      const contentType = res.headers.get("content-type");
      if (!contentType) {
        return null;
      }
      return contentType.includes("application/json") ? res.json() : res;
    }, opts.retry);
  }
  async *fetchPaginated(url, opts) {
    const endpoint = typeof url === "string" ? new URL2(url, this.apiUrl) : new URL2(url.href);
    if (!endpoint.searchParams.has("limit")) {
      endpoint.searchParams.set("limit", "100");
    }
    let next;
    do {
      if (next) {
        await sleep(100);
        endpoint.searchParams.set("until", String(next));
      }
      const res = await this.fetch(
        endpoint.href,
        opts
      );
      yield res;
      next = res.pagination?.next;
    } while (next);
  }
  get cwd() {
    return process.cwd();
  }
  set cwd(v) {
    process.chdir(v);
  }
};

export {
  require_dist3 as require_dist,
  printIndications,
  require_open,
  revocationRequest,
  processRevocationResponse,
  login,
  readConfigFile,
  writeToConfigFile,
  readAuthConfigFile,
  writeToAuthConfigFile,
  getConfigFilePath,
  getAuthConfigFilePath,
  readLocalConfig,
  sleep,
  isJSONObject,
  Client
};
