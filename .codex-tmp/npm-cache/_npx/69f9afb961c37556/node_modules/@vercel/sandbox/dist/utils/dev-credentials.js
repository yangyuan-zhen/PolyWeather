"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cachedGenerateCredentials = void 0;
exports.shouldPromptForCredentials = shouldPromptForCredentials;
exports.generateCredentials = generateCredentials;
exports.signInAndGetToken = signInAndGetToken;
const picocolors_1 = __importDefault(require("picocolors"));
const ms_1 = __importDefault(require("ms"));
const Log = __importStar(require("./log"));
async function importAuth() {
    const auth = await Promise.resolve().then(() => __importStar(require("../auth/index")));
    return auth;
}
function shouldPromptForCredentials() {
    return (process.env.NODE_ENV !== "production" &&
        !["1", "true"].includes(process.env.CI || "") &&
        process.stdout.isTTY &&
        process.stdin.isTTY);
}
/**
 * Returns cached credentials for the given team/project combination.
 *
 * @remarks
 * The cache is keyed by `teamId` and `projectId`. A new credential generation
 * is triggered only when these values change or when a previous attempt failed.
 *
 * **Important:** Successfully resolved credentials are cached indefinitely and
 * will not be refreshed even if the token expires. Cache invalidation only occurs
 * on rejection (error). This is intentional for development use cases where
 * short-lived sessions don't require proactive token refresh.
 */
exports.cachedGenerateCredentials = (() => {
    let cache = null;
    return async (opts) => {
        if (!cache ||
            cache[0].teamId !== opts.teamId ||
            cache[0].projectId !== opts.projectId) {
            const promise = generateCredentials(opts).catch((err) => {
                cache = null;
                throw err;
            });
            cache = [opts, promise];
        }
        const v = await cache[1];
        Log.write("warn", `using inferred credentials team=${v.teamId} project=${v.projectId}`);
        return v;
    };
})();
/**
 * Generates credentials by authenticating and inferring scope.
 *
 * @internal This is exported for testing purposes. Consider using
 * {@link cachedGenerateCredentials} instead, which caches the result
 * to avoid redundant authentication flows.
 */
async function generateCredentials(opts) {
    const { OAuth, pollForToken, getAuth, updateAuthConfig, inferScope } = await importAuth();
    let auth = getAuth();
    if (!auth?.token) {
        const timeout = process.env.VERCEL_URL
            ? /* when deployed to vercel we don't want to have a long timeout */ "1 minute"
            : "5 minutes";
        auth = await signInAndGetToken({ OAuth, pollForToken, getAuth }, timeout);
    }
    if (auth?.refreshToken &&
        auth.expiresAt &&
        auth.expiresAt.getTime() <= Date.now()) {
        const oauth = await OAuth();
        const newToken = await oauth.refreshToken(auth.refreshToken);
        auth = {
            expiresAt: new Date(Date.now() + newToken.expires_in * 1000),
            token: newToken.access_token,
            refreshToken: newToken.refresh_token || auth.refreshToken,
        };
        updateAuthConfig(auth);
    }
    if (!auth?.token) {
        throw new Error([
            `Failed to retrieve authentication token.`,
            `${picocolors_1.default.bold("hint:")} Set VERCEL_OIDC_TOKEN or provide a Vercel API token.`,
            "├▶ Sandbox docs: https://vercel.com/docs/vercel-sandbox",
            "╰▶ Access tokens: https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token",
        ].join("\n"));
    }
    if (opts.teamId && opts.projectId) {
        return {
            token: auth.token,
            teamId: opts.teamId,
            projectId: opts.projectId,
        };
    }
    const scope = await inferScope({ teamId: opts.teamId, token: auth.token });
    if (scope.created) {
        Log.write("info", `Created default project "${scope.projectId}" in team "${scope.teamId}".`);
    }
    return {
        token: auth.token,
        teamId: opts.teamId || scope.teamId,
        projectId: opts.projectId || scope.projectId,
    };
}
async function signInAndGetToken(auth, timeout) {
    Log.write("warn", [
        `No VERCEL_OIDC_TOKEN environment variable found, initiating device authorization flow...`,
        `│  ${picocolors_1.default.bold("help:")} this flow only happens on development environment.`,
        `│  In production, make sure to set up a proper token, or set up Vercel OIDC [https://vercel.com/docs/oidc].`,
    ]);
    const oauth = await auth.OAuth();
    const request = await oauth.deviceAuthorizationRequest();
    Log.write("info", [
        `╰▶ To authenticate, visit: ${request.verification_uri_complete}`,
        `   or visit ${picocolors_1.default.italic(request.verification_uri)} and type ${picocolors_1.default.bold(request.user_code)}`,
        `   Press ${picocolors_1.default.bold("<return>")} to open in your browser`,
    ]);
    let error;
    const generator = auth.pollForToken({ request, oauth });
    let done = false;
    let spawnedTimeout = setTimeout(() => {
        if (done)
            return;
        const message = [
            `Authentication flow timed out after ${timeout}.`,
            `│  Make sure to provide a token to avoid prompting an interactive flow.`,
            `╰▶ ${picocolors_1.default.bold("help:")} Link your project with ${Log.code("npx vercel link")} to refresh OIDC token automatically.`,
        ].join("\n");
        error = new Error(message);
        // Note: generator.return() initiates cooperative cancellation. The generator's
        // finally block will abort pending setTimeout calls, but any in-flight HTTP
        // request will complete before the generator terminates. This is acceptable
        // for this dev-only timeout scenario.
        generator.return();
    }, (0, ms_1.default)(timeout));
    try {
        for await (const event of generator) {
            switch (event._tag) {
                case "SlowDown":
                case "Timeout":
                case "Response":
                    break;
                case "Error":
                    error = event.error;
                    break;
                default:
                    throw new Error(`Unknown event type: ${JSON.stringify(event)}`);
            }
        }
    }
    finally {
        done = true;
        clearTimeout(spawnedTimeout);
    }
    if (error) {
        Log.write("error", `${picocolors_1.default.bold("error:")} Authentication failed: ${error.message}`);
        throw error;
    }
    Log.write("success", `${picocolors_1.default.bold("done!")} Authenticated successfully!`);
    const stored = auth.getAuth();
    return stored;
}
//# sourceMappingURL=dev-credentials.js.map