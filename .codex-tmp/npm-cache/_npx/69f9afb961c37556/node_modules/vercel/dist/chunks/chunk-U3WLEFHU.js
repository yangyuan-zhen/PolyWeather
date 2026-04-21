import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  output_manager_default,
  require_signal_exit
} from "./chunk-ZQKJVHXY.js";
import {
  __commonJS,
  __require,
  __toESM
} from "./chunk-TZ2YI2VH.js";

// ../../internals/constants/dist/index.js
var require_dist = __commonJS({
  "../../internals/constants/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TITLE = exports.NAME = exports.LOGO = exports.PROJECT_ENV_TARGET = void 0;
    exports.PROJECT_ENV_TARGET = [
      "production",
      "preview",
      "development"
    ];
    exports.LOGO = "\u25B2";
    exports.NAME = "vercel";
    exports.TITLE = "Vercel";
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf)
        Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb)
            process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb)
            process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb)
                cb(er);
            });
          }
          if (Object.setPrototypeOf)
            Object.setPrototypeOf(rename, fs$rename);
          return rename;
        }(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf)
          Object.setPrototypeOf(read, fs$read);
        return read;
      }(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      }(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback)
                  callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback)
                    callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb)
                  cb(er);
                return;
              }
              fs2.futimes(fd, at, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb)
                    cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at, mt) {
            var fd = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb)
              process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig)
          return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er))
              er = null;
            if (cb)
              cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig)
          return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er))
              throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig)
          return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er))
              er = null;
            if (cb)
              cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig)
          return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er))
              throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig)
          return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0)
                stats.uid += 4294967296;
              if (stats.gid < 0)
                stats.gid += 4294967296;
            }
            if (cb)
              cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig)
          return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0)
              stats.uid += 4294967296;
            if (stats.gid < 0)
              stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream))
          return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding)
          this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path, options) {
        if (!(this instanceof WriteStream))
          return new WriteStream(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = Symbol.for("graceful-fs.queue");
      previousSymbol = Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      }(fs.close);
      fs.closeSync = function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      }(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile;
      function readFile(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile;
      function writeFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open;
      function open(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// ../../node_modules/.pnpm/strip-bom@3.0.0/node_modules/strip-bom/index.js
var require_strip_bom = __commonJS({
  "../../node_modules/.pnpm/strip-bom@3.0.0/node_modules/strip-bom/index.js"(exports, module) {
    "use strict";
    module.exports = (x) => {
      if (typeof x !== "string") {
        throw new TypeError("Expected a string, got " + typeof x);
      }
      if (x.charCodeAt(0) === 65279) {
        return x.slice(1);
      }
      return x;
    };
  }
});

// ../../node_modules/.pnpm/is-arrayish@0.2.1/node_modules/is-arrayish/index.js
var require_is_arrayish = __commonJS({
  "../../node_modules/.pnpm/is-arrayish@0.2.1/node_modules/is-arrayish/index.js"(exports, module) {
    "use strict";
    module.exports = function isArrayish(obj) {
      if (!obj) {
        return false;
      }
      return obj instanceof Array || Array.isArray(obj) || obj.length >= 0 && obj.splice instanceof Function;
    };
  }
});

// ../../node_modules/.pnpm/error-ex@1.3.2/node_modules/error-ex/index.js
var require_error_ex = __commonJS({
  "../../node_modules/.pnpm/error-ex@1.3.2/node_modules/error-ex/index.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var isArrayish = require_is_arrayish();
    var errorEx = function errorEx2(name, properties) {
      if (!name || name.constructor !== String) {
        properties = name || {};
        name = Error.name;
      }
      var errorExError = function ErrorEXError(message) {
        if (!this) {
          return new ErrorEXError(message);
        }
        message = message instanceof Error ? message.message : message || this.message;
        Error.call(this, message);
        Error.captureStackTrace(this, errorExError);
        this.name = name;
        Object.defineProperty(this, "message", {
          configurable: true,
          enumerable: false,
          get: function() {
            var newMessage = message.split(/\r?\n/g);
            for (var key in properties) {
              if (!properties.hasOwnProperty(key)) {
                continue;
              }
              var modifier = properties[key];
              if ("message" in modifier) {
                newMessage = modifier.message(this[key], newMessage) || newMessage;
                if (!isArrayish(newMessage)) {
                  newMessage = [newMessage];
                }
              }
            }
            return newMessage.join("\n");
          },
          set: function(v) {
            message = v;
          }
        });
        var overwrittenStack = null;
        var stackDescriptor = Object.getOwnPropertyDescriptor(this, "stack");
        var stackGetter = stackDescriptor.get;
        var stackValue = stackDescriptor.value;
        delete stackDescriptor.value;
        delete stackDescriptor.writable;
        stackDescriptor.set = function(newstack) {
          overwrittenStack = newstack;
        };
        stackDescriptor.get = function() {
          var stack = (overwrittenStack || (stackGetter ? stackGetter.call(this) : stackValue)).split(/\r?\n+/g);
          if (!overwrittenStack) {
            stack[0] = this.name + ": " + this.message;
          }
          var lineCount = 1;
          for (var key in properties) {
            if (!properties.hasOwnProperty(key)) {
              continue;
            }
            var modifier = properties[key];
            if ("line" in modifier) {
              var line = modifier.line(this[key]);
              if (line) {
                stack.splice(lineCount++, 0, "    " + line);
              }
            }
            if ("stack" in modifier) {
              modifier.stack(this[key], stack);
            }
          }
          return stack.join("\n");
        };
        Object.defineProperty(this, "stack", stackDescriptor);
      };
      if (Object.setPrototypeOf) {
        Object.setPrototypeOf(errorExError.prototype, Error.prototype);
        Object.setPrototypeOf(errorExError, Error);
      } else {
        util.inherits(errorExError, Error);
      }
      return errorExError;
    };
    errorEx.append = function(str, def) {
      return {
        message: function(v, message) {
          v = v || def;
          if (v) {
            message[0] += " " + str.replace("%s", v.toString());
          }
          return message;
        }
      };
    };
    errorEx.line = function(str, def) {
      return {
        line: function(v) {
          v = v || def;
          if (v) {
            return str.replace("%s", v.toString());
          }
          return null;
        }
      };
    };
    module.exports = errorEx;
  }
});

// ../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/vendor/unicode.js
var require_unicode = __commonJS({
  "../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/vendor/unicode.js"(exports, module) {
    var Uni = module.exports;
    module.exports.isWhiteSpace = function isWhiteSpace(x) {
      return x === " " || x === "\xA0" || x === "\uFEFF" || x >= "	" && x <= "\r" || x === "\u1680" || x === "\u180E" || x >= "\u2000" && x <= "\u200A" || x === "\u2028" || x === "\u2029" || x === "\u202F" || x === "\u205F" || x === "\u3000";
    };
    module.exports.isWhiteSpaceJSON = function isWhiteSpaceJSON(x) {
      return x === " " || x === "	" || x === "\n" || x === "\r";
    };
    module.exports.isLineTerminator = function isLineTerminator(x) {
      return x === "\n" || x === "\r" || x === "\u2028" || x === "\u2029";
    };
    module.exports.isLineTerminatorJSON = function isLineTerminatorJSON(x) {
      return x === "\n" || x === "\r";
    };
    module.exports.isIdentifierStart = function isIdentifierStart(x) {
      return x === "$" || x === "_" || x >= "A" && x <= "Z" || x >= "a" && x <= "z" || x >= "\x80" && Uni.NonAsciiIdentifierStart.test(x);
    };
    module.exports.isIdentifierPart = function isIdentifierPart(x) {
      return x === "$" || x === "_" || x >= "A" && x <= "Z" || x >= "a" && x <= "z" || x >= "0" && x <= "9" || x >= "\x80" && Uni.NonAsciiIdentifierPart.test(x);
    };
    module.exports.NonAsciiIdentifierStart = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
    module.exports.NonAsciiIdentifierPart = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
  }
});

// ../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/vendor/parse.js
var require_parse = __commonJS({
  "../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/vendor/parse.js"(exports, module) {
    var Uni = require_unicode();
    function isHexDigit(x) {
      return x >= "0" && x <= "9" || x >= "A" && x <= "F" || x >= "a" && x <= "f";
    }
    function isOctDigit(x) {
      return x >= "0" && x <= "7";
    }
    function isDecDigit(x) {
      return x >= "0" && x <= "9";
    }
    var unescapeMap = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      "b": "\b",
      "f": "\f",
      "n": "\n",
      "r": "\r",
      "t": "	",
      "v": "\v",
      "/": "/"
    };
    function formatError(input, msg, position, lineno, column, json5) {
      var result = msg + " at " + (lineno + 1) + ":" + (column + 1), tmppos = position - column - 1, srcline = "", underline = "";
      var isLineTerminator = json5 ? Uni.isLineTerminator : Uni.isLineTerminatorJSON;
      if (tmppos < position - 70) {
        tmppos = position - 70;
      }
      while (1) {
        var chr = input[++tmppos];
        if (isLineTerminator(chr) || tmppos === input.length) {
          if (position >= tmppos) {
            underline += "^";
          }
          break;
        }
        srcline += chr;
        if (position === tmppos) {
          underline += "^";
        } else if (position > tmppos) {
          underline += input[tmppos] === "	" ? "	" : " ";
        }
        if (srcline.length > 78)
          break;
      }
      return result + "\n" + srcline + "\n" + underline;
    }
    function parse(input, options) {
      var json5 = !(options.mode === "json" || options.legacy);
      var isLineTerminator = json5 ? Uni.isLineTerminator : Uni.isLineTerminatorJSON;
      var isWhiteSpace = json5 ? Uni.isWhiteSpace : Uni.isWhiteSpaceJSON;
      var length = input.length, lineno = 0, linestart = 0, position = 0, stack = [];
      var tokenStart = function() {
      };
      var tokenEnd = function(v) {
        return v;
      };
      if (options._tokenize) {
        ;
        (function() {
          var start = null;
          tokenStart = function() {
            if (start !== null)
              throw Error("internal error, token overlap");
            start = position;
          };
          tokenEnd = function(v, type) {
            if (start != position) {
              var hash = {
                raw: input.substr(start, position - start),
                type,
                stack: stack.slice(0)
              };
              if (v !== void 0)
                hash.value = v;
              options._tokenize.call(null, hash);
            }
            start = null;
            return v;
          };
        })();
      }
      function fail(msg) {
        var column = position - linestart;
        if (!msg) {
          if (position < length) {
            var token = "'" + JSON.stringify(input[position]).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
            if (!msg)
              msg = "Unexpected token " + token;
          } else {
            if (!msg)
              msg = "Unexpected end of input";
          }
        }
        var error = SyntaxError(formatError(input, msg, position, lineno, column, json5));
        error.row = lineno + 1;
        error.column = column + 1;
        throw error;
      }
      function newline(chr) {
        if (chr === "\r" && input[position] === "\n")
          position++;
        linestart = position;
        lineno++;
      }
      function parseGeneric() {
        var result;
        while (position < length) {
          tokenStart();
          var chr = input[position++];
          if (chr === '"' || chr === "'" && json5) {
            return tokenEnd(parseString(chr), "literal");
          } else if (chr === "{") {
            tokenEnd(void 0, "separator");
            return parseObject();
          } else if (chr === "[") {
            tokenEnd(void 0, "separator");
            return parseArray();
          } else if (chr === "-" || chr === "." || isDecDigit(chr) || json5 && (chr === "+" || chr === "I" || chr === "N")) {
            return tokenEnd(parseNumber(), "literal");
          } else if (chr === "n") {
            parseKeyword("null");
            return tokenEnd(null, "literal");
          } else if (chr === "t") {
            parseKeyword("true");
            return tokenEnd(true, "literal");
          } else if (chr === "f") {
            parseKeyword("false");
            return tokenEnd(false, "literal");
          } else {
            position--;
            return tokenEnd(void 0);
          }
        }
      }
      function parseKey() {
        var result;
        while (position < length) {
          tokenStart();
          var chr = input[position++];
          if (chr === '"' || chr === "'" && json5) {
            return tokenEnd(parseString(chr), "key");
          } else if (chr === "{") {
            tokenEnd(void 0, "separator");
            return parseObject();
          } else if (chr === "[") {
            tokenEnd(void 0, "separator");
            return parseArray();
          } else if (chr === "." || isDecDigit(chr)) {
            return tokenEnd(parseNumber(true), "key");
          } else if (json5 && Uni.isIdentifierStart(chr) || chr === "\\" && input[position] === "u") {
            var rollback = position - 1;
            var result = parseIdentifier();
            if (result === void 0) {
              position = rollback;
              return tokenEnd(void 0);
            } else {
              return tokenEnd(result, "key");
            }
          } else {
            position--;
            return tokenEnd(void 0);
          }
        }
      }
      function skipWhiteSpace() {
        tokenStart();
        while (position < length) {
          var chr = input[position++];
          if (isLineTerminator(chr)) {
            position--;
            tokenEnd(void 0, "whitespace");
            tokenStart();
            position++;
            newline(chr);
            tokenEnd(void 0, "newline");
            tokenStart();
          } else if (isWhiteSpace(chr)) {
          } else if (chr === "/" && json5 && (input[position] === "/" || input[position] === "*")) {
            position--;
            tokenEnd(void 0, "whitespace");
            tokenStart();
            position++;
            skipComment(input[position++] === "*");
            tokenEnd(void 0, "comment");
            tokenStart();
          } else {
            position--;
            break;
          }
        }
        return tokenEnd(void 0, "whitespace");
      }
      function skipComment(multi) {
        while (position < length) {
          var chr = input[position++];
          if (isLineTerminator(chr)) {
            if (!multi) {
              position--;
              return;
            }
            newline(chr);
          } else if (chr === "*" && multi) {
            if (input[position] === "/") {
              position++;
              return;
            }
          } else {
          }
        }
        if (multi) {
          fail("Unclosed multiline comment");
        }
      }
      function parseKeyword(keyword) {
        var _pos = position;
        var len = keyword.length;
        for (var i = 1; i < len; i++) {
          if (position >= length || keyword[i] != input[position]) {
            position = _pos - 1;
            fail();
          }
          position++;
        }
      }
      function parseObject() {
        var result = options.null_prototype ? /* @__PURE__ */ Object.create(null) : {}, empty_object = {}, is_non_empty = false;
        while (position < length) {
          skipWhiteSpace();
          var item1 = parseKey();
          skipWhiteSpace();
          tokenStart();
          var chr = input[position++];
          tokenEnd(void 0, "separator");
          if (chr === "}" && item1 === void 0) {
            if (!json5 && is_non_empty) {
              position--;
              fail("Trailing comma in object");
            }
            return result;
          } else if (chr === ":" && item1 !== void 0) {
            skipWhiteSpace();
            stack.push(item1);
            var item2 = parseGeneric();
            stack.pop();
            if (item2 === void 0)
              fail("No value found for key " + item1);
            if (typeof item1 !== "string") {
              if (!json5 || typeof item1 !== "number") {
                fail("Wrong key type: " + item1);
              }
            }
            if ((item1 in empty_object || empty_object[item1] != null) && options.reserved_keys !== "replace") {
              if (options.reserved_keys === "throw") {
                fail("Reserved key: " + item1);
              } else {
              }
            } else {
              if (typeof options.reviver === "function") {
                item2 = options.reviver.call(null, item1, item2);
              }
              if (item2 !== void 0) {
                is_non_empty = true;
                Object.defineProperty(result, item1, {
                  value: item2,
                  enumerable: true,
                  configurable: true,
                  writable: true
                });
              }
            }
            skipWhiteSpace();
            tokenStart();
            var chr = input[position++];
            tokenEnd(void 0, "separator");
            if (chr === ",") {
              continue;
            } else if (chr === "}") {
              return result;
            } else {
              fail();
            }
          } else {
            position--;
            fail();
          }
        }
        fail();
      }
      function parseArray() {
        var result = [];
        while (position < length) {
          skipWhiteSpace();
          stack.push(result.length);
          var item = parseGeneric();
          stack.pop();
          skipWhiteSpace();
          tokenStart();
          var chr = input[position++];
          tokenEnd(void 0, "separator");
          if (item !== void 0) {
            if (typeof options.reviver === "function") {
              item = options.reviver.call(null, String(result.length), item);
            }
            if (item === void 0) {
              result.length++;
              item = true;
            } else {
              result.push(item);
            }
          }
          if (chr === ",") {
            if (item === void 0) {
              fail("Elisions are not supported");
            }
          } else if (chr === "]") {
            if (!json5 && item === void 0 && result.length) {
              position--;
              fail("Trailing comma in array");
            }
            return result;
          } else {
            position--;
            fail();
          }
        }
      }
      function parseNumber() {
        position--;
        var start = position, chr = input[position++], t;
        var to_num = function(is_octal2) {
          var str = input.substr(start, position - start);
          if (is_octal2) {
            var result = parseInt(str.replace(/^0o?/, ""), 8);
          } else {
            var result = Number(str);
          }
          if (Number.isNaN(result)) {
            position--;
            fail('Bad numeric literal - "' + input.substr(start, position - start + 1) + '"');
          } else if (!json5 && !str.match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?(e[+-]?[0-9]+)?$/i)) {
            position--;
            fail('Non-json numeric literal - "' + input.substr(start, position - start + 1) + '"');
          } else {
            return result;
          }
        };
        if (chr === "-" || chr === "+" && json5)
          chr = input[position++];
        if (chr === "N" && json5) {
          parseKeyword("NaN");
          return NaN;
        }
        if (chr === "I" && json5) {
          parseKeyword("Infinity");
          return to_num();
        }
        if (chr >= "1" && chr <= "9") {
          while (position < length && isDecDigit(input[position]))
            position++;
          chr = input[position++];
        }
        if (chr === "0") {
          chr = input[position++];
          var is_octal = chr === "o" || chr === "O" || isOctDigit(chr);
          var is_hex = chr === "x" || chr === "X";
          if (json5 && (is_octal || is_hex)) {
            while (position < length && (is_hex ? isHexDigit : isOctDigit)(input[position]))
              position++;
            var sign = 1;
            if (input[start] === "-") {
              sign = -1;
              start++;
            } else if (input[start] === "+") {
              start++;
            }
            return sign * to_num(is_octal);
          }
        }
        if (chr === ".") {
          while (position < length && isDecDigit(input[position]))
            position++;
          chr = input[position++];
        }
        if (chr === "e" || chr === "E") {
          chr = input[position++];
          if (chr === "-" || chr === "+")
            position++;
          while (position < length && isDecDigit(input[position]))
            position++;
          chr = input[position++];
        }
        position--;
        return to_num();
      }
      function parseIdentifier() {
        position--;
        var result = "";
        while (position < length) {
          var chr = input[position++];
          if (chr === "\\" && input[position] === "u" && isHexDigit(input[position + 1]) && isHexDigit(input[position + 2]) && isHexDigit(input[position + 3]) && isHexDigit(input[position + 4])) {
            chr = String.fromCharCode(parseInt(input.substr(position + 1, 4), 16));
            position += 5;
          }
          if (result.length) {
            if (Uni.isIdentifierPart(chr)) {
              result += chr;
            } else {
              position--;
              return result;
            }
          } else {
            if (Uni.isIdentifierStart(chr)) {
              result += chr;
            } else {
              return void 0;
            }
          }
        }
        fail();
      }
      function parseString(endChar) {
        var result = "";
        while (position < length) {
          var chr = input[position++];
          if (chr === endChar) {
            return result;
          } else if (chr === "\\") {
            if (position >= length)
              fail();
            chr = input[position++];
            if (unescapeMap[chr] && (json5 || chr != "v" && chr != "'")) {
              result += unescapeMap[chr];
            } else if (json5 && isLineTerminator(chr)) {
              newline(chr);
            } else if (chr === "u" || chr === "x" && json5) {
              var off = chr === "u" ? 4 : 2;
              for (var i = 0; i < off; i++) {
                if (position >= length)
                  fail();
                if (!isHexDigit(input[position]))
                  fail("Bad escape sequence");
                position++;
              }
              result += String.fromCharCode(parseInt(input.substr(position - off, off), 16));
            } else if (json5 && isOctDigit(chr)) {
              if (chr < "4" && isOctDigit(input[position]) && isOctDigit(input[position + 1])) {
                var digits = 3;
              } else if (isOctDigit(input[position])) {
                var digits = 2;
              } else {
                var digits = 1;
              }
              position += digits - 1;
              result += String.fromCharCode(parseInt(input.substr(position - digits, digits), 8));
            } else if (json5) {
              result += chr;
            } else {
              position--;
              fail();
            }
          } else if (isLineTerminator(chr)) {
            fail();
          } else {
            if (!json5 && chr.charCodeAt(0) < 32) {
              position--;
              fail("Unexpected control character");
            }
            result += chr;
          }
        }
        fail();
      }
      skipWhiteSpace();
      var return_value = parseGeneric();
      if (return_value !== void 0 || position < length) {
        skipWhiteSpace();
        if (position >= length) {
          if (typeof options.reviver === "function") {
            return_value = options.reviver.call(null, "", return_value);
          }
          return return_value;
        } else {
          fail();
        }
      } else {
        if (position) {
          fail("No data, only a whitespace");
        } else {
          fail("No data, empty input");
        }
      }
    }
    module.exports.parse = function parseJSON(input, options) {
      if (typeof options === "function") {
        options = {
          reviver: options
        };
      }
      if (input === void 0) {
        return void 0;
      }
      if (typeof input !== "string")
        input = String(input);
      if (options == null)
        options = {};
      if (options.reserved_keys == null)
        options.reserved_keys = "ignore";
      if (options.reserved_keys === "throw" || options.reserved_keys === "ignore") {
        if (options.null_prototype == null) {
          options.null_prototype = true;
        }
      }
      try {
        return parse(input, options);
      } catch (err) {
        if (err instanceof SyntaxError && err.row != null && err.column != null) {
          var old_err = err;
          err = SyntaxError(old_err.message);
          err.column = old_err.column;
          err.row = old_err.row;
        }
        throw err;
      }
    };
    module.exports.tokenize = function tokenizeJSON(input, options) {
      if (options == null)
        options = {};
      options._tokenize = function(smth) {
        if (options._addstack)
          smth.stack.unshift.apply(smth.stack, options._addstack);
        tokens.push(smth);
      };
      var tokens = [];
      tokens.data = module.exports.parse(input, options);
      return tokens;
    };
  }
});

// ../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/index.js
var require_parse_json = __commonJS({
  "../../node_modules/.pnpm/parse-json@3.0.0/node_modules/parse-json/index.js"(exports, module) {
    "use strict";
    var errorEx = require_error_ex();
    var fallback = require_parse();
    function appendPosition(message) {
      const posRe = / at (\d+:\d+) in/;
      const numbers = posRe.exec(message);
      return message.replace(posRe, " in") + ":" + numbers[1];
    }
    var JSONError = errorEx("JSONError", {
      fileName: errorEx.append("in %s"),
      appendPosition: {
        message: (shouldAppend, original) => {
          if (shouldAppend) {
            original[0] = appendPosition(original[0]);
          }
          return original;
        }
      }
    });
    module.exports = (input, reviver, filename) => {
      if (typeof reviver === "string") {
        filename = reviver;
        reviver = null;
      }
      try {
        try {
          return JSON.parse(input, reviver);
        } catch (err) {
          fallback.parse(input, {
            mode: "json",
            reviver
          });
          throw err;
        }
      } catch (err) {
        const jsonErr = new JSONError(err);
        if (filename) {
          jsonErr.fileName = filename;
          jsonErr.appendPosition = true;
        }
        throw jsonErr;
      }
    };
  }
});

// ../../node_modules/.pnpm/pify@2.3.0/node_modules/pify/index.js
var require_pify = __commonJS({
  "../../node_modules/.pnpm/pify@2.3.0/node_modules/pify/index.js"(exports, module) {
    "use strict";
    var processFn = function(fn, P, opts) {
      return function() {
        var that = this;
        var args = new Array(arguments.length);
        for (var i = 0; i < arguments.length; i++) {
          args[i] = arguments[i];
        }
        return new P(function(resolve, reject) {
          args.push(function(err, result) {
            if (err) {
              reject(err);
            } else if (opts.multiArgs) {
              var results = new Array(arguments.length - 1);
              for (var i2 = 1; i2 < arguments.length; i2++) {
                results[i2 - 1] = arguments[i2];
              }
              resolve(results);
            } else {
              resolve(result);
            }
          });
          fn.apply(that, args);
        });
      };
    };
    var pify = module.exports = function(obj, P, opts) {
      if (typeof P !== "function") {
        opts = P;
        P = Promise;
      }
      opts = opts || {};
      opts.exclude = opts.exclude || [/.+Sync$/];
      var filter = function(key) {
        var match = function(pattern) {
          return typeof pattern === "string" ? key === pattern : pattern.test(key);
        };
        return opts.include ? opts.include.some(match) : !opts.exclude.some(match);
      };
      var ret = typeof obj === "function" ? function() {
        if (opts.excludeMain) {
          return obj.apply(this, arguments);
        }
        return processFn(obj, P, opts).apply(this, arguments);
      } : {};
      return Object.keys(obj).reduce(function(ret2, key) {
        var x = obj[key];
        ret2[key] = typeof x === "function" && filter(key) ? processFn(x, P, opts) : x;
        return ret2;
      }, ret);
    };
    pify.all = pify;
  }
});

// ../../node_modules/.pnpm/load-json-file@3.0.0/node_modules/load-json-file/index.js
var require_load_json_file = __commonJS({
  "../../node_modules/.pnpm/load-json-file@3.0.0/node_modules/load-json-file/index.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = require_graceful_fs();
    var stripBom = require_strip_bom();
    var parseJson = require_parse_json();
    var pify = require_pify();
    var parse = (data, fp) => parseJson(stripBom(data), path.relative(".", fp));
    module.exports = (fp) => pify(fs.readFile)(fp, "utf8").then((data) => parse(data, fp));
    module.exports.sync = (fp) => parse(fs.readFileSync(fp, "utf8"), fp);
  }
});

// ../../node_modules/.pnpm/imurmurhash@0.1.4/node_modules/imurmurhash/imurmurhash.js
var require_imurmurhash = __commonJS({
  "../../node_modules/.pnpm/imurmurhash@0.1.4/node_modules/imurmurhash/imurmurhash.js"(exports, module) {
    (function() {
      var cache;
      function MurmurHash3(key, seed) {
        var m = this instanceof MurmurHash3 ? this : cache;
        m.reset(seed);
        if (typeof key === "string" && key.length > 0) {
          m.hash(key);
        }
        if (m !== this) {
          return m;
        }
      }
      ;
      MurmurHash3.prototype.hash = function(key) {
        var h1, k1, i, top, len;
        len = key.length;
        this.len += len;
        k1 = this.k1;
        i = 0;
        switch (this.rem) {
          case 0:
            k1 ^= len > i ? key.charCodeAt(i++) & 65535 : 0;
          case 1:
            k1 ^= len > i ? (key.charCodeAt(i++) & 65535) << 8 : 0;
          case 2:
            k1 ^= len > i ? (key.charCodeAt(i++) & 65535) << 16 : 0;
          case 3:
            k1 ^= len > i ? (key.charCodeAt(i) & 255) << 24 : 0;
            k1 ^= len > i ? (key.charCodeAt(i++) & 65280) >> 8 : 0;
        }
        this.rem = len + this.rem & 3;
        len -= this.rem;
        if (len > 0) {
          h1 = this.h1;
          while (1) {
            k1 = k1 * 11601 + (k1 & 65535) * 3432906752 & 4294967295;
            k1 = k1 << 15 | k1 >>> 17;
            k1 = k1 * 13715 + (k1 & 65535) * 461832192 & 4294967295;
            h1 ^= k1;
            h1 = h1 << 13 | h1 >>> 19;
            h1 = h1 * 5 + 3864292196 & 4294967295;
            if (i >= len) {
              break;
            }
            k1 = key.charCodeAt(i++) & 65535 ^ (key.charCodeAt(i++) & 65535) << 8 ^ (key.charCodeAt(i++) & 65535) << 16;
            top = key.charCodeAt(i++);
            k1 ^= (top & 255) << 24 ^ (top & 65280) >> 8;
          }
          k1 = 0;
          switch (this.rem) {
            case 3:
              k1 ^= (key.charCodeAt(i + 2) & 65535) << 16;
            case 2:
              k1 ^= (key.charCodeAt(i + 1) & 65535) << 8;
            case 1:
              k1 ^= key.charCodeAt(i) & 65535;
          }
          this.h1 = h1;
        }
        this.k1 = k1;
        return this;
      };
      MurmurHash3.prototype.result = function() {
        var k1, h1;
        k1 = this.k1;
        h1 = this.h1;
        if (k1 > 0) {
          k1 = k1 * 11601 + (k1 & 65535) * 3432906752 & 4294967295;
          k1 = k1 << 15 | k1 >>> 17;
          k1 = k1 * 13715 + (k1 & 65535) * 461832192 & 4294967295;
          h1 ^= k1;
        }
        h1 ^= this.len;
        h1 ^= h1 >>> 16;
        h1 = h1 * 51819 + (h1 & 65535) * 2246770688 & 4294967295;
        h1 ^= h1 >>> 13;
        h1 = h1 * 44597 + (h1 & 65535) * 3266445312 & 4294967295;
        h1 ^= h1 >>> 16;
        return h1 >>> 0;
      };
      MurmurHash3.prototype.reset = function(seed) {
        this.h1 = typeof seed === "number" ? seed : 0;
        this.rem = this.k1 = this.len = 0;
        return this;
      };
      cache = new MurmurHash3();
      if (typeof module != "undefined") {
        module.exports = MurmurHash3;
      } else {
        this.MurmurHash3 = MurmurHash3;
      }
    })();
  }
});

// ../../node_modules/.pnpm/write-file-atomic@2.4.3/node_modules/write-file-atomic/index.js
var require_write_file_atomic = __commonJS({
  "../../node_modules/.pnpm/write-file-atomic@2.4.3/node_modules/write-file-atomic/index.js"(exports, module) {
    "use strict";
    module.exports = writeFile;
    module.exports.sync = writeFileSync;
    module.exports._getTmpname = getTmpname;
    module.exports._cleanupOnExit = cleanupOnExit;
    var fs = require_graceful_fs();
    var MurmurHash3 = require_imurmurhash();
    var onExit = require_signal_exit();
    var path = __require("path");
    var activeFiles = {};
    var threadId = function getId() {
      try {
        var workerThreads = __require("worker_threads");
        return workerThreads.threadId;
      } catch (e) {
        return 0;
      }
    }();
    var invocations = 0;
    function getTmpname(filename) {
      return filename + "." + MurmurHash3(__filename).hash(String(process.pid)).hash(String(threadId)).hash(String(++invocations)).result();
    }
    function cleanupOnExit(tmpfile) {
      return function() {
        try {
          fs.unlinkSync(typeof tmpfile === "function" ? tmpfile() : tmpfile);
        } catch (_) {
        }
      };
    }
    function writeFile(filename, data, options, callback) {
      if (options) {
        if (options instanceof Function) {
          callback = options;
          options = {};
        } else if (typeof options === "string") {
          options = { encoding: options };
        }
      } else {
        options = {};
      }
      var Promise2 = options.Promise || global.Promise;
      var truename;
      var fd;
      var tmpfile;
      var removeOnExitHandler = onExit(cleanupOnExit(() => tmpfile));
      var absoluteName = path.resolve(filename);
      new Promise2(function serializeSameFile(resolve) {
        if (!activeFiles[absoluteName])
          activeFiles[absoluteName] = [];
        activeFiles[absoluteName].push(resolve);
        if (activeFiles[absoluteName].length === 1)
          resolve();
      }).then(function getRealPath() {
        return new Promise2(function(resolve) {
          fs.realpath(filename, function(_, realname) {
            truename = realname || filename;
            tmpfile = getTmpname(truename);
            resolve();
          });
        });
      }).then(function stat() {
        return new Promise2(function stat2(resolve) {
          if (options.mode && options.chown)
            resolve();
          else {
            fs.stat(truename, function(err, stats) {
              if (err || !stats)
                resolve();
              else {
                options = Object.assign({}, options);
                if (options.mode == null) {
                  options.mode = stats.mode;
                }
                if (options.chown == null && process.getuid) {
                  options.chown = { uid: stats.uid, gid: stats.gid };
                }
                resolve();
              }
            });
          }
        });
      }).then(function thenWriteFile() {
        return new Promise2(function(resolve, reject) {
          fs.open(tmpfile, "w", options.mode, function(err, _fd) {
            fd = _fd;
            if (err)
              reject(err);
            else
              resolve();
          });
        });
      }).then(function write() {
        return new Promise2(function(resolve, reject) {
          if (Buffer.isBuffer(data)) {
            fs.write(fd, data, 0, data.length, 0, function(err) {
              if (err)
                reject(err);
              else
                resolve();
            });
          } else if (data != null) {
            fs.write(fd, String(data), 0, String(options.encoding || "utf8"), function(err) {
              if (err)
                reject(err);
              else
                resolve();
            });
          } else
            resolve();
        });
      }).then(function syncAndClose() {
        return new Promise2(function(resolve, reject) {
          if (options.fsync !== false) {
            fs.fsync(fd, function(err) {
              if (err)
                fs.close(fd, () => reject(err));
              else
                fs.close(fd, resolve);
            });
          } else {
            fs.close(fd, resolve);
          }
        });
      }).then(function chown() {
        fd = null;
        if (options.chown) {
          return new Promise2(function(resolve, reject) {
            fs.chown(tmpfile, options.chown.uid, options.chown.gid, function(err) {
              if (err)
                reject(err);
              else
                resolve();
            });
          });
        }
      }).then(function chmod() {
        if (options.mode) {
          return new Promise2(function(resolve, reject) {
            fs.chmod(tmpfile, options.mode, function(err) {
              if (err)
                reject(err);
              else
                resolve();
            });
          });
        }
      }).then(function rename() {
        return new Promise2(function(resolve, reject) {
          fs.rename(tmpfile, truename, function(err) {
            if (err)
              reject(err);
            else
              resolve();
          });
        });
      }).then(function success() {
        removeOnExitHandler();
        callback();
      }, function fail(err) {
        return new Promise2((resolve) => {
          return fd ? fs.close(fd, resolve) : resolve();
        }).then(() => {
          removeOnExitHandler();
          fs.unlink(tmpfile, function() {
            callback(err);
          });
        });
      }).then(function checkQueue() {
        activeFiles[absoluteName].shift();
        if (activeFiles[absoluteName].length > 0) {
          activeFiles[absoluteName][0]();
        } else
          delete activeFiles[absoluteName];
      });
    }
    function writeFileSync(filename, data, options) {
      if (typeof options === "string")
        options = { encoding: options };
      else if (!options)
        options = {};
      try {
        filename = fs.realpathSync(filename);
      } catch (ex) {
      }
      var tmpfile = getTmpname(filename);
      if (!options.mode || !options.chown) {
        try {
          var stats = fs.statSync(filename);
          options = Object.assign({}, options);
          if (!options.mode) {
            options.mode = stats.mode;
          }
          if (!options.chown && process.getuid) {
            options.chown = { uid: stats.uid, gid: stats.gid };
          }
        } catch (ex) {
        }
      }
      var fd;
      var cleanup = cleanupOnExit(tmpfile);
      var removeOnExitHandler = onExit(cleanup);
      try {
        fd = fs.openSync(tmpfile, "w", options.mode);
        if (Buffer.isBuffer(data)) {
          fs.writeSync(fd, data, 0, data.length, 0);
        } else if (data != null) {
          fs.writeSync(fd, String(data), 0, String(options.encoding || "utf8"));
        }
        if (options.fsync !== false) {
          fs.fsyncSync(fd);
        }
        fs.closeSync(fd);
        if (options.chown)
          fs.chownSync(tmpfile, options.chown.uid, options.chown.gid);
        if (options.mode)
          fs.chmodSync(tmpfile, options.mode);
        fs.renameSync(tmpfile, filename);
        removeOnExitHandler();
      } catch (err) {
        if (fd) {
          try {
            fs.closeSync(fd);
          } catch (ex) {
          }
        }
        removeOnExitHandler();
        cleanup();
        throw err;
      }
    }
  }
});

// ../../node_modules/.pnpm/is-plain-obj@1.1.0/node_modules/is-plain-obj/index.js
var require_is_plain_obj = __commonJS({
  "../../node_modules/.pnpm/is-plain-obj@1.1.0/node_modules/is-plain-obj/index.js"(exports, module) {
    "use strict";
    var toString = Object.prototype.toString;
    module.exports = function(x) {
      var prototype;
      return toString.call(x) === "[object Object]" && (prototype = Object.getPrototypeOf(x), prototype === null || prototype === Object.getPrototypeOf({}));
    };
  }
});

// ../../node_modules/.pnpm/sort-keys@1.1.2/node_modules/sort-keys/index.js
var require_sort_keys = __commonJS({
  "../../node_modules/.pnpm/sort-keys@1.1.2/node_modules/sort-keys/index.js"(exports, module) {
    "use strict";
    var isPlainObj = require_is_plain_obj();
    module.exports = function(obj, opts) {
      if (!isPlainObj(obj)) {
        throw new TypeError("Expected a plain object");
      }
      opts = opts || {};
      if (typeof opts === "function") {
        opts = { compare: opts };
      }
      var deep = opts.deep;
      var seenInput = [];
      var seenOutput = [];
      var sortKeys = function(x) {
        var seenIndex = seenInput.indexOf(x);
        if (seenIndex !== -1) {
          return seenOutput[seenIndex];
        }
        var ret = {};
        var keys = Object.keys(x).sort(opts.compare);
        seenInput.push(x);
        seenOutput.push(ret);
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          var val = x[key];
          ret[key] = deep && isPlainObj(val) ? sortKeys(val) : val;
        }
        return ret;
      };
      return sortKeys(obj);
    };
  }
});

// ../../node_modules/.pnpm/pify@3.0.0/node_modules/pify/index.js
var require_pify2 = __commonJS({
  "../../node_modules/.pnpm/pify@3.0.0/node_modules/pify/index.js"(exports, module) {
    "use strict";
    var processFn = (fn, opts) => function() {
      const P = opts.promiseModule;
      const args = new Array(arguments.length);
      for (let i = 0; i < arguments.length; i++) {
        args[i] = arguments[i];
      }
      return new P((resolve, reject) => {
        if (opts.errorFirst) {
          args.push(function(err, result) {
            if (opts.multiArgs) {
              const results = new Array(arguments.length - 1);
              for (let i = 1; i < arguments.length; i++) {
                results[i - 1] = arguments[i];
              }
              if (err) {
                results.unshift(err);
                reject(results);
              } else {
                resolve(results);
              }
            } else if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        } else {
          args.push(function(result) {
            if (opts.multiArgs) {
              const results = new Array(arguments.length - 1);
              for (let i = 0; i < arguments.length; i++) {
                results[i] = arguments[i];
              }
              resolve(results);
            } else {
              resolve(result);
            }
          });
        }
        fn.apply(this, args);
      });
    };
    module.exports = (obj, opts) => {
      opts = Object.assign({
        exclude: [/.+(Sync|Stream)$/],
        errorFirst: true,
        promiseModule: Promise
      }, opts);
      const filter = (key) => {
        const match = (pattern) => typeof pattern === "string" ? key === pattern : pattern.test(key);
        return opts.include ? opts.include.some(match) : !opts.exclude.some(match);
      };
      let ret;
      if (typeof obj === "function") {
        ret = function() {
          if (opts.excludeMain) {
            return obj.apply(this, arguments);
          }
          return processFn(obj, opts).apply(this, arguments);
        };
      } else {
        ret = Object.create(Object.getPrototypeOf(obj));
      }
      for (const key in obj) {
        const x = obj[key];
        ret[key] = typeof x === "function" && filter(key) ? processFn(x, opts) : x;
      }
      return ret;
    };
  }
});

// ../../node_modules/.pnpm/make-dir@1.3.0/node_modules/make-dir/index.js
var require_make_dir = __commonJS({
  "../../node_modules/.pnpm/make-dir@1.3.0/node_modules/make-dir/index.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var path = __require("path");
    var pify = require_pify2();
    var defaults = {
      mode: 511 & ~process.umask(),
      fs
    };
    var checkPath = (pth) => {
      if (process.platform === "win32") {
        const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ""));
        if (pathHasInvalidWinCharacters) {
          const err = new Error(`Path contains invalid characters: ${pth}`);
          err.code = "EINVAL";
          throw err;
        }
      }
    };
    module.exports = (input, opts) => Promise.resolve().then(() => {
      checkPath(input);
      opts = Object.assign({}, defaults, opts);
      const mkdir = pify(opts.fs.mkdir);
      const stat = pify(opts.fs.stat);
      const make = (pth) => {
        return mkdir(pth, opts.mode).then(() => pth).catch((err) => {
          if (err.code === "ENOENT") {
            if (err.message.includes("null bytes") || path.dirname(pth) === pth) {
              throw err;
            }
            return make(path.dirname(pth)).then(() => make(pth));
          }
          return stat(pth).then((stats) => stats.isDirectory() ? pth : Promise.reject()).catch(() => {
            throw err;
          });
        });
      };
      return make(path.resolve(input));
    });
    module.exports.sync = (input, opts) => {
      checkPath(input);
      opts = Object.assign({}, defaults, opts);
      const make = (pth) => {
        try {
          opts.fs.mkdirSync(pth, opts.mode);
        } catch (err) {
          if (err.code === "ENOENT") {
            if (err.message.includes("null bytes") || path.dirname(pth) === pth) {
              throw err;
            }
            make(path.dirname(pth));
            return make(pth);
          }
          try {
            if (!opts.fs.statSync(pth).isDirectory()) {
              throw new Error("The path is not a directory");
            }
          } catch (_) {
            throw err;
          }
        }
        return pth;
      };
      return make(path.resolve(input));
    };
  }
});

// ../../node_modules/.pnpm/detect-indent@5.0.0/node_modules/detect-indent/index.js
var require_detect_indent = __commonJS({
  "../../node_modules/.pnpm/detect-indent@5.0.0/node_modules/detect-indent/index.js"(exports, module) {
    "use strict";
    var INDENT_RE = /^(?:( )+|\t+)/;
    function getMostUsed(indents) {
      let result = 0;
      let maxUsed = 0;
      let maxWeight = 0;
      for (const entry of indents) {
        const key = entry[0];
        const val = entry[1];
        const u = val[0];
        const w = val[1];
        if (u > maxUsed || u === maxUsed && w > maxWeight) {
          maxUsed = u;
          maxWeight = w;
          result = Number(key);
        }
      }
      return result;
    }
    module.exports = (str) => {
      if (typeof str !== "string") {
        throw new TypeError("Expected a string");
      }
      let tabs = 0;
      let spaces = 0;
      let prev = 0;
      const indents = /* @__PURE__ */ new Map();
      let current;
      let isIndent;
      for (const line of str.split(/\n/g)) {
        if (!line) {
          continue;
        }
        let indent2;
        const matches = line.match(INDENT_RE);
        if (matches) {
          indent2 = matches[0].length;
          if (matches[1]) {
            spaces++;
          } else {
            tabs++;
          }
        } else {
          indent2 = 0;
        }
        const diff = indent2 - prev;
        prev = indent2;
        if (diff) {
          isIndent = diff > 0;
          current = indents.get(isIndent ? diff : -diff);
          if (current) {
            current[0]++;
          } else {
            current = [1, 0];
            indents.set(diff, current);
          }
        } else if (current) {
          current[1] += Number(isIndent);
        }
      }
      const amount = getMostUsed(indents);
      let type;
      let indent;
      if (!amount) {
        type = null;
        indent = "";
      } else if (spaces >= tabs) {
        type = "space";
        indent = " ".repeat(amount);
      } else {
        type = "tab";
        indent = "	".repeat(amount);
      }
      return {
        amount,
        type,
        indent
      };
    };
  }
});

// ../../node_modules/.pnpm/write-json-file@2.2.0/node_modules/write-json-file/index.js
var require_write_json_file = __commonJS({
  "../../node_modules/.pnpm/write-json-file@2.2.0/node_modules/write-json-file/index.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = require_graceful_fs();
    var writeFileAtomic = require_write_file_atomic();
    var sortKeys = require_sort_keys();
    var makeDir = require_make_dir();
    var pify = require_pify();
    var detectIndent = require_detect_indent();
    var init = (fn, fp, data, opts) => {
      if (!fp) {
        throw new TypeError("Expected a filepath");
      }
      if (data === void 0) {
        throw new TypeError("Expected data to stringify");
      }
      opts = Object.assign({
        indent: "	",
        sortKeys: false
      }, opts);
      if (opts.sortKeys) {
        data = sortKeys(data, {
          deep: true,
          compare: typeof opts.sortKeys === "function" && opts.sortKeys
        });
      }
      return fn(fp, data, opts);
    };
    var readFile = (fp) => pify(fs.readFile)(fp, "utf8").catch(() => {
    });
    var main = (fp, data, opts) => {
      return (opts.detectIndent ? readFile(fp) : Promise.resolve()).then((str) => {
        const indent = str ? detectIndent(str).indent : opts.indent;
        const json = JSON.stringify(data, opts.replacer, indent);
        return pify(writeFileAtomic)(fp, `${json}
`, { mode: opts.mode });
      });
    };
    var mainSync = (fp, data, opts) => {
      let indent = opts.indent;
      if (opts.detectIndent) {
        try {
          const file = fs.readFileSync(fp, "utf8");
          indent = detectIndent(file).indent;
        } catch (err) {
          if (err.code !== "ENOENT") {
            throw err;
          }
        }
      }
      const json = JSON.stringify(data, opts.replacer, indent);
      return writeFileAtomic.sync(fp, `${json}
`, { mode: opts.mode });
    };
    module.exports = (fp, data, opts) => {
      return makeDir(path.dirname(fp), { fs }).then(() => init(main, fp, data, opts));
    };
    module.exports.sync = (fp, data, opts) => {
      makeDir.sync(path.dirname(fp), { fs });
      init(mainSync, fp, data, opts);
    };
  }
});

// src/util/telemetry/index.ts
import { randomUUID as randomUUID2 } from "crypto";
import os from "os";
var import_constants = __toESM(require_dist(), 1);
import { spawn } from "child_process";
import { cloneEnv } from "@vercel/build-utils";

// src/util/telemetry/session.ts
var import_load_json_file = __toESM(require_load_json_file(), 1);
var import_write_json_file = __toESM(require_write_json_file(), 1);
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
var DEFAULT_CLI_SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1e3;
var DEFAULT_CLI_SESSION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1e3;
function isPersistedCliSession(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value;
  return typeof session.id === "string" && typeof session.createdAt === "number" && Number.isFinite(session.createdAt) && typeof session.lastSeenAt === "number" && Number.isFinite(session.lastSeenAt);
}
function isPersistedCliDevice(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const device = value;
  return typeof device.id === "string";
}
function readPersistedCliSession(filePath) {
  try {
    const session = import_load_json_file.default.sync(filePath);
    return isPersistedCliSession(session) ? session : null;
  } catch {
    return null;
  }
}
function writePersistedCliSession(filePath, session) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    import_write_json_file.default.sync(filePath, session, { indent: 2 });
  } catch {
  }
}
function readPersistedCliDevice(filePath) {
  try {
    const device = import_load_json_file.default.sync(filePath);
    return isPersistedCliDevice(device) ? device : null;
  } catch {
    return null;
  }
}
function writePersistedCliDevice(filePath, device) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    import_write_json_file.default.sync(filePath, device, { indent: 2 });
  } catch {
  }
}
function getOrCreatePersistedCliSession(opts) {
  const now = opts.now?.() ?? Date.now();
  const inactivityTimeoutMs = opts.inactivityTimeoutMs ?? DEFAULT_CLI_SESSION_INACTIVITY_TIMEOUT_MS;
  const maxLifetimeMs = opts.maxLifetimeMs ?? DEFAULT_CLI_SESSION_MAX_LIFETIME_MS;
  const existing = readPersistedCliSession(opts.filePath);
  const shouldReuseExisting = existing && now - existing.lastSeenAt <= inactivityTimeoutMs && now - existing.createdAt <= maxLifetimeMs;
  const session = shouldReuseExisting ? {
    ...existing,
    lastSeenAt: now
  } : {
    id: randomUUID(),
    createdAt: now,
    lastSeenAt: now
  };
  writePersistedCliSession(opts.filePath, session);
  return session;
}
function touchPersistedCliSession(opts, session) {
  const nextSession = {
    ...session,
    lastSeenAt: opts.now?.() ?? Date.now()
  };
  writePersistedCliSession(opts.filePath, nextSession);
  return nextSession;
}
function getOrCreatePersistedCliDevice(opts) {
  const existing = readPersistedCliDevice(opts.filePath);
  if (existing) {
    return existing;
  }
  const device = {
    id: randomUUID()
  };
  writePersistedCliDevice(opts.filePath, device);
  return device;
}

// src/util/telemetry/index.ts
var LogLabel = `['telemetry']:`;
var MAX_ERROR_SERVER_MESSAGE_LENGTH = 500;
var TelemetryClient = class {
  constructor({ opts }) {
    this.redactedValue = "[REDACTED]";
    this.noValueToTriggerPrompt = "[TRIGGER_PROMPT]";
    this.redactedArgumentsLength = (args) => {
      if (args && args.length === 1) {
        return "ONE";
      }
      if (args.length > 1) {
        return "MANY";
      }
      return "NONE";
    };
    this.redactedTargetName = (target) => {
      if (import_constants.PROJECT_ENV_TARGET.includes(target)) {
        return target;
      }
      return this.redactedValue;
    };
    this.isDebug = opts.isDebug || false;
    this.store = opts.store;
  }
  track(eventData) {
    if (this.isDebug) {
      output_manager_default.debug(`${LogLabel} ${eventData.key}:${eventData.value}`);
    }
    const event = {
      id: randomUUID2(),
      eventTime: Date.now(),
      ...eventData
    };
    this.store.add(event);
  }
  trackCliCommand(eventData) {
    this.track({
      key: `command:${eventData.command}`,
      value: eventData.value
    });
  }
  trackCliSubcommand(eventData) {
    this.track({
      key: `subcommand:${eventData.subcommand}`,
      value: eventData.value
    });
  }
  trackCliArgument(eventData) {
    if (eventData.value) {
      this.track({
        key: `argument:${eventData.arg}`,
        value: eventData.value
      });
    }
  }
  trackCliOption(eventData) {
    this.track({
      key: `option:${eventData.option}`,
      value: eventData.value
    });
  }
  trackCommandOutput(eventData) {
    this.track({
      key: `output:${eventData.key}`,
      value: eventData.value
    });
  }
  trackCliFlag(flag) {
    this.track({
      key: `flag:${flag}`,
      value: "TRUE"
    });
  }
  trackOidcTokenRefresh(count) {
    this.track({
      key: "oidc-token-refresh",
      value: `${count}`
    });
  }
  trackCPUs() {
    this.track({
      key: "cpu_count",
      value: String(os.cpus().length)
    });
  }
  trackAgenticUse(agent) {
    if (agent) {
      this.track({
        key: "agent",
        value: agent
      });
    }
  }
  trackPlatform() {
    this.track({
      key: "platform",
      value: os.platform()
    });
  }
  trackArch() {
    this.track({
      key: "arch",
      value: os.arch()
    });
  }
  trackCI(ciVendorName) {
    if (ciVendorName) {
      this.track({
        key: "ci",
        value: ciVendorName
      });
    }
  }
  trackStdinIsTTY(isTTY) {
    this.track({
      key: "stdin_is_tty",
      value: isTTY ? "true" : "false"
    });
  }
  trackVersion(version) {
    if (version) {
      this.track({
        key: "version",
        value: version
      });
    }
  }
  trackDefaultDeploy() {
    this.track({
      key: "default-deploy",
      value: "TRUE"
    });
  }
  trackProjectId(projectId) {
    if (projectId) {
      this.track({
        key: "project_id",
        value: projectId
      });
    }
  }
  trackInvocationId(invocationId) {
    if (invocationId) {
      this.track({
        key: "invocation_id",
        value: invocationId
      });
    }
  }
  trackDeviceId(deviceId) {
    if (deviceId) {
      this.track({
        key: "device_id",
        value: deviceId
      });
    }
  }
  trackErrorStatus(status) {
    if (typeof status !== "undefined") {
      this.track({
        key: "error_status",
        value: String(status)
      });
    }
  }
  trackErrorCode(code) {
    if (code) {
      this.track({
        key: "error_code",
        value: code
      });
    }
  }
  trackErrorSlug(slug) {
    if (slug) {
      this.track({
        key: "error_slug",
        value: slug
      });
    }
  }
  trackErrorAction(action) {
    if (action) {
      this.track({
        key: "error_action",
        value: action
      });
    }
  }
  trackErrorServerMessage(serverMessage) {
    if (serverMessage) {
      const normalizedServerMessage = serverMessage.trim().replace(/\s+/g, " ");
      this.track({
        key: "error_server_message",
        value: normalizedServerMessage.slice(
          0,
          MAX_ERROR_SERVER_MESSAGE_LENGTH
        )
      });
    }
  }
  trackExtension() {
    this.track({
      key: "extension",
      value: this.redactedValue
    });
  }
  trackLoginState(state) {
    if (state === "started")
      this.loginAttempt = randomUUID2();
    if (this.loginAttempt) {
      this.track({ key: `login:attempt:${this.loginAttempt}`, value: state });
    }
    if (state !== "started")
      this.loginAttempt = void 0;
  }
  trackCliFlagHelp(command, subcommands) {
    let subcommand;
    if (subcommands) {
      subcommand = Array.isArray(subcommands) ? subcommands[0] : subcommands;
    }
    this.track({
      key: "flag:help",
      value: subcommand ? `${command}:${subcommand}` : command
    });
  }
  /**
   * Tracks the --format option for JSON output.
   * This is a common option across many commands, so it's defined in the base class.
   */
  trackCliOptionFormat(format) {
    if (format) {
      const allowedFormat = ["json"].includes(format) ? format : this.redactedValue;
      this.trackCliOption({
        option: "format",
        value: allowedFormat
      });
    }
  }
};
var TelemetryEventStore = class {
  constructor(opts) {
    this.teamId = "NO_TEAM_ID";
    this.userId = "NO_USER_ID";
    this.projectId = "NO_PROJECT_ID";
    this.isDebug = opts?.isDebug || false;
    this.events = [];
    this.config = opts?.config;
    this.cliDeviceOptions = opts?.cliDevice;
    this.cliSessionOptions = opts?.cliSession;
    this.invocationId = randomUUID2();
    this.deviceId = randomUUID2();
    if (this.cliDeviceOptions) {
      this.cliDevice = getOrCreatePersistedCliDevice(this.cliDeviceOptions);
      this.deviceId = this.cliDevice.id;
    }
    if (this.cliSessionOptions) {
      this.cliSession = getOrCreatePersistedCliSession(this.cliSessionOptions);
      this.sessionId = this.cliSession.id;
    } else {
      this.sessionId = randomUUID2();
    }
  }
  add(event) {
    event.sessionId = this.sessionId;
    event.teamId = this.teamId;
    event.userId = this.userId;
    event.projectId = this.projectId;
    this.events.push(event);
  }
  updateTeamId(teamId) {
    if (teamId) {
      this.teamId = teamId;
    }
  }
  updateUserId(userId) {
    if (userId) {
      this.userId = userId;
    }
  }
  updateProjectId(projectId) {
    if (projectId) {
      this.projectId = projectId;
    }
  }
  get hasUserId() {
    return this.userId !== "NO_USER_ID";
  }
  get currentProjectId() {
    return this.projectId;
  }
  get currentInvocationId() {
    return this.invocationId;
  }
  get currentDeviceId() {
    return this.deviceId;
  }
  get readonlyEvents() {
    return Array.from(this.events);
  }
  reset() {
    this.events = [];
  }
  get enabled() {
    if (process.env.VERCEL_TELEMETRY_DISABLED) {
      return false;
    }
    return this.config?.enabled ?? true;
  }
  async save() {
    if (this.cliSession && this.cliSessionOptions) {
      this.cliSession = touchPersistedCliSession(
        this.cliSessionOptions,
        this.cliSession
      );
    }
    if (this.isDebug) {
      output_manager_default.log(`${LogLabel} Flushing Events`);
      for (const event of this.events) {
        event.teamId = this.teamId;
        event.userId = this.userId;
        event.projectId = this.projectId;
        output_manager_default.log(JSON.stringify(event));
      }
      return;
    }
    if (this.enabled) {
      const sessionId = this.events[0].sessionId;
      if (!sessionId) {
        output_manager_default.debug("Unable to send metrics: no session ID");
        return;
      }
      const events = this.events.map((event) => {
        delete event.sessionId;
        delete event.teamId;
        delete event.userId;
        delete event.projectId;
        const { eventTime, ...rest } = event;
        return {
          event_time: eventTime,
          team_id: this.teamId,
          user_id: this.userId,
          project_id: this.projectId,
          ...rest
        };
      });
      const payload = {
        headers: {
          "Client-id": "vercel-cli",
          "x-vercel-cli-topic-id": "generic",
          "x-vercel-cli-session-id": sessionId
        },
        body: events
      };
      await this.sendToSubprocess(payload, output_manager_default.debugEnabled);
    }
  }
  /**
   * Send the telemetry events to a subprocess, this invokes the `telemetry flush` command
   * and passes a stringified payload to the subprocess, there's a risk that if the event payload
   * increases in size, it may exceed the maximum buffer size for the subprocess, in which case the
   * child process will error and not send anything.
   * FIXME: handle max buffer size
   */
  async sendToSubprocess(payload, outputDebugEnabled) {
    const args = [process.execPath, process.argv[0], process.argv[1]];
    if (args[0] === args[1]) {
      args.shift();
    }
    const nodeBinaryPath = args[0];
    const script = [
      ...args.slice(1),
      "telemetry",
      "flush",
      JSON.stringify(payload)
    ];
    const env = cloneEnv(process.env, {
      VERCEL_TELEMETRY_DISABLED: "1"
    });
    if (outputDebugEnabled) {
      return new Promise((resolve) => {
        const childProcess = spawn(nodeBinaryPath, script, {
          env,
          stdio: ["ignore", "pipe", "pipe"]
        });
        childProcess.stderr.on("data", (data) => output_manager_default.debug(data.toString()));
        childProcess.stdout.on("data", (data) => output_manager_default.debug(data.toString()));
        childProcess.on("error", (d) => {
          output_manager_default.debug(d);
        });
        const timeout = setTimeout(() => {
          output_manager_default.debug("Telemetry subprocess killed due to timeout");
          childProcess.kill();
        }, 2e3);
        childProcess.on("exit", (code) => {
          output_manager_default.debug(`Telemetry subprocess exited with code ${code}`);
          childProcess.unref();
          timeout.unref();
          resolve();
        });
      });
    } else {
      const childProcess = spawn(nodeBinaryPath, script, {
        stdio: "ignore",
        env,
        windowsHide: true,
        detached: true
      });
      childProcess.unref();
    }
  }
};

export {
  require_graceful_fs,
  require_dist,
  require_load_json_file,
  require_write_json_file,
  TelemetryClient,
  TelemetryEventStore
};
/*! Bundled license information:

imurmurhash/imurmurhash.js:
  (**
   * @preserve
   * JS Implementation of incremental MurmurHash3 (r150) (as of May 10, 2013)
   *
   * @author <a href="mailto:jensyt@gmail.com">Jens Taylor</a>
   * @see http://github.com/homebrewing/brauhaus-diff
   * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
   * @see http://github.com/garycourt/murmurhash-js
   * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
   * @see http://sites.google.com/site/murmurhash/
   *)
*/
