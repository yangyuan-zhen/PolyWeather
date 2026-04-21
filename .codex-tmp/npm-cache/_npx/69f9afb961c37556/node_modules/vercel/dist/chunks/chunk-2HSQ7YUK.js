import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  __commonJS,
  __require
} from "./chunk-TZ2YI2VH.js";

// ../../node_modules/.pnpm/async-listen@3.0.0/node_modules/async-listen/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/.pnpm/async-listen@3.0.0/node_modules/async-listen/dist/index.js"(exports) {
    "use strict";
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.listen = void 0;
    var http = __require("http");
    var https = __require("https");
    var path_1 = __require("path");
    var events_1 = __require("events");
    var getProtocol = (server) => {
      if (typeof server.protocol === "string")
        return server.protocol;
      if (server instanceof http.Server)
        return "http";
      if (server instanceof https.Server)
        return "https";
    };
    function listen(server, ...args) {
      return __awaiter(this, void 0, void 0, function* () {
        server.listen(...args, () => {
        });
        yield (0, events_1.once)(server, "listening");
        const addressInfo = server.address();
        if (!addressInfo) {
          throw new Error("Server not listening");
        }
        let host;
        let protocol = getProtocol(server);
        if (typeof addressInfo === "string") {
          host = encodeURIComponent((0, path_1.resolve)(addressInfo));
          if (protocol) {
            protocol += "+unix";
          } else {
            protocol = "unix";
          }
        } else {
          const { address, port, family } = addressInfo;
          host = family === "IPv6" ? `[${address}]` : address;
          host += `:${port}`;
          if (!protocol) {
            protocol = "tcp";
          }
        }
        return new URL(`${protocol}://${host}`);
      });
    }
    exports.listen = listen;
    exports.default = listen;
  }
});

export {
  require_dist
};
