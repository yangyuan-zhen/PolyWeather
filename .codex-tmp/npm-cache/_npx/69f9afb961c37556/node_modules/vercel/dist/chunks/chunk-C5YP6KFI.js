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
  __commonJS,
  __require,
  __toESM
} from "./chunk-TZ2YI2VH.js";

// ../../node_modules/.pnpm/@next+env@11.1.2/node_modules/@next/env/dist/index.js
var require_dist2 = __commonJS({
  "../../node_modules/.pnpm/@next+env@11.1.2/node_modules/@next/env/dist/index.js"(exports, module) {
    module.exports = function(n, r) {
      "use strict";
      var e = {};
      function __webpack_require__(r2) {
        if (e[r2]) {
          return e[r2].exports;
        }
        var t = e[r2] = { i: r2, l: false, exports: {} };
        n[r2].call(t.exports, t, t.exports, __webpack_require__);
        t.l = true;
        return t.exports;
      }
      __webpack_require__.ab = __dirname + "/";
      function startup() {
        return __webpack_require__(903);
      }
      r(__webpack_require__);
      return startup();
    }({ 148: function(n) {
      "use strict";
      var r = function(n2) {
        var r2 = n2.ignoreProcessEnv ? {} : process.env;
        var e = function(t2) {
          var o2 = t2.match(/(.?\${?(?:[a-zA-Z0-9_]+)?}?)/g) || [];
          return o2.reduce(function(t3, o3) {
            var c2 = /(.?)\${?([a-zA-Z0-9_]+)?}?/g.exec(o3);
            var s = c2[1];
            var i, f;
            if (s === "\\") {
              f = c2[0];
              i = f.replace("\\$", "$");
            } else {
              var p = c2[2];
              f = c2[0].substring(s.length);
              i = r2.hasOwnProperty(p) ? r2[p] : n2.parsed[p] || "";
              i = e(i);
            }
            return t3.replace(f, i);
          }, t2);
        };
        for (var t in n2.parsed) {
          var o = r2.hasOwnProperty(t) ? r2[t] : n2.parsed[t];
          n2.parsed[t] = e(o);
        }
        for (var c in n2.parsed) {
          r2[c] = n2.parsed[c];
        }
        return n2;
      };
      n.exports = r;
    }, 548: function(n, r, e) {
      const t = e(747);
      const o = e(622);
      function log(n2) {
        console.log(`[dotenv][DEBUG] ${n2}`);
      }
      const c = "\n";
      const s = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/;
      const i = /\\n/g;
      const f = /\n|\r|\r\n/;
      function parse(n2, r2) {
        const e2 = Boolean(r2 && r2.debug);
        const t2 = {};
        n2.toString().split(f).forEach(function(n3, r3) {
          const o2 = n3.match(s);
          if (o2 != null) {
            const n4 = o2[1];
            let r4 = o2[2] || "";
            const e3 = r4.length - 1;
            const s2 = r4[0] === '"' && r4[e3] === '"';
            const f2 = r4[0] === "'" && r4[e3] === "'";
            if (f2 || s2) {
              r4 = r4.substring(1, e3);
              if (s2) {
                r4 = r4.replace(i, c);
              }
            } else {
              r4 = r4.trim();
            }
            t2[n4] = r4;
          } else if (e2) {
            log(`did not match key and value when parsing line ${r3 + 1}: ${n3}`);
          }
        });
        return t2;
      }
      function config(n2) {
        let r2 = o.resolve(process.cwd(), ".env");
        let e2 = "utf8";
        let c2 = false;
        if (n2) {
          if (n2.path != null) {
            r2 = n2.path;
          }
          if (n2.encoding != null) {
            e2 = n2.encoding;
          }
          if (n2.debug != null) {
            c2 = true;
          }
        }
        try {
          const n3 = parse(t.readFileSync(r2, { encoding: e2 }), { debug: c2 });
          Object.keys(n3).forEach(function(r3) {
            if (!Object.prototype.hasOwnProperty.call(process.env, r3)) {
              process.env[r3] = n3[r3];
            } else if (c2) {
              log(`"${r3}" is already defined in \`process.env\` and will not be overwritten`);
            }
          });
          return { parsed: n3 };
        } catch (n3) {
          return { error: n3 };
        }
      }
      n.exports.config = config;
      n.exports.parse = parse;
    }, 622: function(n) {
      n.exports = __require("path");
    }, 747: function(n) {
      n.exports = __require("fs");
    }, 903: function(n, r, e) {
      "use strict";
      e.r(r);
      e.d(r, "processEnv", function() {
        return processEnv;
      });
      e.d(r, "loadEnvConfig", function() {
        return loadEnvConfig;
      });
      var t = e(747);
      var o = e.n(t);
      var c = e(622);
      var s = e.n(c);
      var i = e(548);
      var f = e.n(i);
      var p = e(148);
      var u = e.n(p);
      let a = void 0;
      let d = [];
      function processEnv(n2, r2, e2 = console) {
        var t2;
        if (process.env.__NEXT_PROCESSED_ENV || n2.length === 0) {
          return process.env;
        }
        process.env.__NEXT_PROCESSED_ENV = "true";
        const o2 = Object.assign({}, process.env);
        const s2 = {};
        for (const f2 of n2) {
          try {
            let n3 = {};
            n3.parsed = i.parse(f2.contents);
            n3 = u()(n3);
            if (n3.parsed) {
              e2.info(`Loaded env from ${c.join(r2 || "", f2.path)}`);
            }
            for (const r3 of Object.keys(n3.parsed || {})) {
              if (typeof s2[r3] === "undefined" && typeof o2[r3] === "undefined") {
                s2[r3] = (t2 = n3.parsed) === null || t2 === void 0 ? void 0 : t2[r3];
              }
            }
          } catch (n3) {
            e2.error(`Failed to load env from ${c.join(r2 || "", f2.path)}`, n3);
          }
        }
        return Object.assign(process.env, s2);
      }
      function loadEnvConfig(n2, r2, e2 = console) {
        if (a)
          return { combinedEnv: a, loadedEnvFiles: d };
        const o2 = process.env.NODE_ENV === "test";
        const s2 = o2 ? "test" : r2 ? "development" : "production";
        const i2 = [`.env.${s2}.local`, s2 !== "test" && `.env.local`, `.env.${s2}`, ".env"].filter(Boolean);
        for (const r3 of i2) {
          const o3 = c.join(n2, r3);
          try {
            const n3 = t.statSync(o3);
            if (!n3.isFile()) {
              continue;
            }
            const c2 = t.readFileSync(o3, "utf8");
            d.push({ path: r3, contents: c2 });
          } catch (n3) {
            if (n3.code !== "ENOENT") {
              e2.error(`Failed to load env from ${r3}`, n3);
            }
          }
        }
        a = processEnv(d, n2, e2);
        return { combinedEnv: a, loadedEnvFiles: d };
      }
    } }, function(n) {
      "use strict";
      !function() {
        n.r = function(n2) {
          if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
            Object.defineProperty(n2, Symbol.toStringTag, { value: "Module" });
          }
          Object.defineProperty(n2, "__esModule", { value: true });
        };
      }();
      !function() {
        n.n = function(r) {
          var e = r && r.__esModule ? function getDefault() {
            return r["default"];
          } : function getModuleExports() {
            return r;
          };
          n.d(e, "a", e);
          return e;
        };
      }();
      !function() {
        var r = Object.prototype.hasOwnProperty;
        n.d = function(n2, e, t) {
          if (!r.call(n2, e)) {
            Object.defineProperty(n2, e, { enumerable: true, get: t });
          }
        };
      }();
    });
  }
});

// src/util/get-invalid-subcommand.ts
function getInvalidSubcommand(config) {
  return `Please specify a valid subcommand: ${Object.keys(config).join(
    " | "
  )}`;
}

// src/util/input/read-standard-input.ts
async function readStandardInput(stdin) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(""), 500);
    if (stdin.isTTY) {
      resolve("");
    } else {
      stdin.setEncoding("utf8");
      stdin.once("data", resolve);
    }
  });
}

// src/util/target/get-custom-environments.ts
var import_error_utils = __toESM(require_dist(), 1);
async function getCustomEnvironments(client, projectId) {
  try {
    const res = await client.fetch(
      `/projects/${encodeURIComponent(projectId)}/custom-environments`,
      { method: "GET" }
    );
    return res.environments;
  } catch (error) {
    if ((0, import_error_utils.isObject)(error) && error.status === 404) {
      return [];
    }
    throw error;
  }
}
function pickCustomEnvironment(customEnvironments, customEnvironmentSlugOrId) {
  if (!customEnvironmentSlugOrId)
    return void 0;
  return customEnvironments.find(
    ({ slug, id }) => slug === customEnvironmentSlugOrId || id === customEnvironmentSlugOrId
  );
}

export {
  getInvalidSubcommand,
  readStandardInput,
  getCustomEnvironments,
  pickCustomEnvironment,
  require_dist2 as require_dist
};
