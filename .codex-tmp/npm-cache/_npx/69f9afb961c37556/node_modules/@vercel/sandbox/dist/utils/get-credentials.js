"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schema = exports.VercelOidcContextError = exports.LocalOidcContextError = void 0;
exports.getCredentials = getCredentials;
const oidc_1 = require("@vercel/oidc");
const decode_base64_url_1 = require("./decode-base64-url");
const zod_1 = require("zod");
const dev_credentials_1 = require("./dev-credentials");
/**
 * Error thrown when OIDC context is not available in local development,
 * therefore we should guide how to ensure it is set up by linking a project
 */
class LocalOidcContextError extends Error {
    constructor(cause) {
        const message = [
            "Could not get credentials from OIDC context.",
            "Please link your Vercel project using `npx vercel link`.",
            "Then, pull an initial OIDC token with `npx vercel env pull`",
            "and retry.",
            "╰▶ Make sure you are loading `.env.local` correctly, or passing $VERCEL_OIDC_TOKEN directly.",
        ].join("\n");
        super(message, { cause });
        this.name = "LocalOidcContextError";
    }
}
exports.LocalOidcContextError = LocalOidcContextError;
/**
 * Error thrown when OIDC context is not available in Vercel environment,
 * therefore we should guide how to set it up.
 */
class VercelOidcContextError extends Error {
    constructor(cause) {
        const message = [
            "Could not get credentials from OIDC context.",
            "Please make sure OIDC is set up for your project",
            "╰▶ Docs: https://vercel.com/docs/oidc",
        ].join("\n");
        super(message, { cause });
        this.name = "VercelOidcContextError";
    }
}
exports.VercelOidcContextError = VercelOidcContextError;
async function getVercelToken(opts) {
    try {
        const token = await (0, oidc_1.getVercelOidcToken)({
            team: opts.teamId,
            project: opts.projectId,
        });
        return getCredentialsFromOIDCToken(token);
    }
    catch (error) {
        if (!(0, dev_credentials_1.shouldPromptForCredentials)()) {
            if (process.env.VERCEL_URL) {
                throw new VercelOidcContextError(error);
            }
            else {
                throw new LocalOidcContextError(error);
            }
        }
        return await (0, dev_credentials_1.cachedGenerateCredentials)(opts);
    }
}
/**
 * Allow to get credentials to access the Vercel API. Credentials can be
 * provided in two different ways:
 *
 * 1. By passing an object with the `teamId`, `token`, and `projectId` properties.
 * 2. By using an environment variable VERCEL_OIDC_TOKEN.
 *
 * If both methods are used, the object properties take precedence over the
 * environment variable. If neither method is used, an error is thrown.
 */
async function getCredentials(params) {
    const credentials = getCredentialsFromParams(params ?? {});
    if (credentials) {
        return credentials;
    }
    const oidcToken = await getVercelToken({
        teamId: params &&
            typeof params === "object" &&
            "teamId" in params &&
            typeof params.teamId === "string"
            ? params.teamId
            : undefined,
        projectId: params &&
            typeof params === "object" &&
            "projectId" in params &&
            typeof params.projectId === "string"
            ? params.projectId
            : undefined,
    });
    return oidcToken;
}
/**
 * Attempt to extract credentials from the provided parameters. Either all
 * required fields (`token`, `teamId`, and `projectId`) must be present
 * or none of them, otherwise an error is thrown.
 */
function getCredentialsFromParams(params) {
    // Type guard: params must be an object
    if (!params || typeof params !== "object") {
        return null;
    }
    const missing = [
        "token" in params && typeof params.token === "string" ? null : "token",
        "teamId" in params && typeof params.teamId === "string" ? null : "teamId",
        "projectId" in params && typeof params.projectId === "string"
            ? null
            : "projectId",
    ].filter((value) => value !== null);
    if (missing.length === 0) {
        return {
            token: params.token,
            projectId: params.projectId,
            teamId: params.teamId,
        };
    }
    if (missing.length < 3) {
        throw new Error(`Missing credentials parameters to access the Vercel API: ${missing
            .filter((value) => value !== null)
            .join(", ")}`);
    }
    return null;
}
/**
 * Schema to validate the payload of the Vercel OIDC token where we expect
 * to find the `teamId` and `projectId`.
 */
exports.schema = zod_1.z.object({
    exp: zod_1.z.number().optional().describe("Expiry timestamp (seconds since epoch)"),
    iat: zod_1.z.number().optional().describe("Issued at timestamp"),
    owner_id: zod_1.z.string(),
    project_id: zod_1.z.string(),
});
/**
 * Extracts credentials from a Vercel OIDC token. The token is expected to be
 * a JWT with a payload that contains `project_id` and `owner_id`.
 *
 * @param token - The Vercel OIDC token.
 * @returns An object containing the token, projectId, and teamId.
 * @throws If the token is invalid or does not contain the required fields.
 */
function getCredentialsFromOIDCToken(token) {
    try {
        const payload = exports.schema.parse((0, decode_base64_url_1.decodeBase64Url)(token.split(".")[1]));
        return {
            token,
            projectId: payload.project_id,
            teamId: payload.owner_id,
        };
    }
    catch (error) {
        throw new Error(`Invalid Vercel OIDC token: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=get-credentials.js.map