"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePath = normalizePath;
const path_1 = __importDefault(require("path"));
/**
 * Normalize a path and make it relative to `params.extractDir` for inclusion
 * in our tar archives.
 *
 * Relative paths are first resolved to `params.cwd`.
 * Absolute paths are normalized and resolved relative to `params.extractDir`.
 *
 * In addition, paths are normalized so consecutive slashes are removed and
 * stuff like `../..` is resolved appropriately.
 *
 * This function always returns a path relative to `params.extractDir`.
 */
function normalizePath(params) {
    if (!path_1.default.posix.isAbsolute(params.cwd)) {
        throw new Error("cwd dir must be absolute");
    }
    if (!path_1.default.posix.isAbsolute(params.extractDir)) {
        throw new Error("extractDir must be absolute");
    }
    const basePath = path_1.default.posix.isAbsolute(params.filePath)
        ? path_1.default.posix.normalize(params.filePath)
        : path_1.default.posix.join(params.cwd, params.filePath);
    return path_1.default.posix.relative(params.extractDir, basePath);
}
//# sourceMappingURL=normalizePath.js.map