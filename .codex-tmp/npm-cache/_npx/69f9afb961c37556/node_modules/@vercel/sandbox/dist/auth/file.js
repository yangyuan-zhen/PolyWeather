"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuth = void 0;
exports.updateAuthConfig = updateAuthConfig;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = require("node:os");
const xdg_app_paths_1 = __importDefault(require("xdg-app-paths"));
const zod_1 = require("zod");
const zod_2 = require("./zod");
const ZodDate = zod_1.z.number().transform((seconds) => new Date(seconds * 1000));
const AuthFile = zod_1.z.object({
    token: zod_1.z.string().min(1).optional(),
    refreshToken: zod_1.z.string().min(1).optional(),
    expiresAt: ZodDate.optional(),
});
const StoredAuthFile = zod_2.json.pipe(AuthFile);
// Returns whether a directory exists
const isDirectory = (path) => {
    try {
        return node_fs_1.default.lstatSync(path).isDirectory();
    }
    catch (_) {
        // We don't care which kind of error occured, it isn't a directory anyway.
        return false;
    }
};
/**
 * Returns in which directory the config should be present.
 *
 * @internal The `VERCEL_AUTH_CONFIG_DIR` env var is for testing purposes only
 * and is not part of the public API.
 */
const getGlobalPathConfig = () => {
    if (process.env.VERCEL_AUTH_CONFIG_DIR) {
        return process.env.VERCEL_AUTH_CONFIG_DIR;
    }
    const vercelDirectories = (0, xdg_app_paths_1.default)("com.vercel.cli").dataDirs();
    const possibleConfigPaths = [
        ...vercelDirectories, // latest vercel directory
        node_path_1.default.join((0, node_os_1.homedir)(), ".now"), // legacy config in user's home directory
        ...(0, xdg_app_paths_1.default)("now").dataDirs(), // legacy XDG directory
    ];
    // The customPath flag is the preferred location,
    // followed by the vercel directory,
    // followed by the now directory.
    // If none of those exist, use the vercel directory.
    return (possibleConfigPaths.find((configPath) => isDirectory(configPath)) ||
        vercelDirectories[0]);
};
const getAuth = () => {
    try {
        const pathname = node_path_1.default.join(getGlobalPathConfig(), "auth.json");
        return StoredAuthFile.parse(node_fs_1.default.readFileSync(pathname, "utf8"));
    }
    catch {
        return null;
    }
};
exports.getAuth = getAuth;
function updateAuthConfig(config) {
    const pathname = node_path_1.default.join(getGlobalPathConfig(), "auth.json");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(pathname), { recursive: true });
    const content = {
        token: config.token,
        expiresAt: config.expiresAt && Math.round(config.expiresAt.getTime() / 1000),
        refreshToken: config.refreshToken,
    };
    node_fs_1.default.writeFileSync(pathname, JSON.stringify(content) + "\n");
}
//# sourceMappingURL=file.js.map