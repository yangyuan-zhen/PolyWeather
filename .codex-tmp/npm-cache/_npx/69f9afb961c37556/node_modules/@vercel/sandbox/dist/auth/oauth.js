"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuth = OAuth;
exports.isOAuthError = isOAuthError;
const os_1 = __importDefault(require("os"));
const zod_1 = require("zod");
const version_1 = require("../version");
const USER_AGENT = `${os_1.default.hostname()} @ vercel/sandbox/${version_1.VERSION} node-${process.version} ${os_1.default.platform()} (${os_1.default.arch()})`;
const ISSUER = new URL("https://vercel.com");
const CLIENT_ID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp";
const AuthorizationServerMetadata = zod_1.z.object({
    issuer: zod_1.z.string().url(),
    device_authorization_endpoint: zod_1.z.string().url(),
    token_endpoint: zod_1.z.string().url(),
    revocation_endpoint: zod_1.z.string().url(),
    jwks_uri: zod_1.z.string().url(),
    introspection_endpoint: zod_1.z.string().url(),
});
let _as;
const DeviceAuthorization = zod_1.z.object({
    device_code: zod_1.z.string(),
    user_code: zod_1.z.string(),
    verification_uri: zod_1.z.string().url(),
    verification_uri_complete: zod_1.z.string().url(),
    expires_in: zod_1.z.number(),
    interval: zod_1.z.number(),
});
const IntrospectionResponse = zod_1.z
    .object({
    active: zod_1.z.literal(true),
    client_id: zod_1.z.string(),
    session_id: zod_1.z.string(),
})
    .or(zod_1.z.object({ active: zod_1.z.literal(false) }));
/**
 * Returns the Authorization Server Metadata
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationRequest
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationResponse
 */
async function authorizationServerMetadata() {
    if (_as)
        return _as;
    const response = await fetch(new URL(".well-known/openid-configuration", ISSUER), {
        headers: { "Content-Type": "application/json", "user-agent": USER_AGENT },
    });
    _as = AuthorizationServerMetadata.parse(await response.json());
    return _as;
}
async function OAuth() {
    const as = await authorizationServerMetadata();
    return {
        /**
         * Perform the Device Authorization Request
         *
         * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.1
         * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.2
         */
        async deviceAuthorizationRequest() {
            const response = await fetch(as.device_authorization_endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "user-agent": USER_AGENT,
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    scope: "openid offline_access",
                }),
            });
            const json = await response.json();
            const parsed = DeviceAuthorization.safeParse(json);
            if (!parsed.success) {
                throw new OAuthError(`Failed to parse device authorization response: ${parsed.error.message}`, json);
            }
            return {
                device_code: parsed.data.device_code,
                user_code: parsed.data.user_code,
                verification_uri: parsed.data.verification_uri,
                verification_uri_complete: parsed.data.verification_uri_complete,
                expiresAt: Date.now() + parsed.data.expires_in * 1000,
                interval: parsed.data.interval,
            };
        },
        /**
         * Perform the Device Access Token Request
         *
         * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.4
         */
        async deviceAccessTokenRequest(device_code) {
            try {
                return [
                    null,
                    await fetch(as.token_endpoint, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "user-agent": USER_AGENT,
                        },
                        body: new URLSearchParams({
                            client_id: CLIENT_ID,
                            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                            device_code,
                        }),
                        signal: AbortSignal.timeout(10 * 1000),
                    }),
                ];
            }
            catch (error) {
                if (error instanceof Error)
                    return [error];
                return [
                    new Error("An unknown error occurred. See the logs for details.", {
                        cause: error,
                    }),
                ];
            }
        },
        /**
         * Process the Token request Response
         *
         * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
         */
        async processTokenResponse(response) {
            const json = await response.json();
            const processed = TokenSet.safeParse(json);
            if (!processed.success) {
                return [
                    new OAuthError(`Failed to parse token response: ${processed.error.message}`, json),
                ];
            }
            return [null, processed.data];
        },
        /**
         * Perform a Token Revocation Request.
         *
         * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.1
         * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.2
         */
        async revokeToken(token) {
            const response = await fetch(as.revocation_endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "user-agent": USER_AGENT,
                },
                body: new URLSearchParams({ token, client_id: CLIENT_ID }),
            });
            if (response.ok)
                return;
            const json = await response.json();
            return new OAuthError("Revocation request failed", json);
        },
        /**
         * Perform Refresh Token Request.
         *
         * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6
         */
        async refreshToken(token) {
            const response = await fetch(as.token_endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "user-agent": USER_AGENT,
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    grant_type: "refresh_token",
                    refresh_token: token,
                }),
            });
            const [tokensError, tokenSet] = await this.processTokenResponse(response);
            if (tokensError)
                throw tokensError;
            return tokenSet;
        },
        /**
         * Perform Token Introspection Request.
         *
         * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.1
         */
        async introspectToken(token) {
            const response = await fetch(as.introspection_endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "user-agent": USER_AGENT,
                },
                body: new URLSearchParams({ token }),
            });
            const json = await response.json();
            const processed = IntrospectionResponse.safeParse(json);
            if (!processed.success) {
                throw new OAuthError(`Failed to parse introspection response: ${processed.error.message}`, json);
            }
            return processed.data;
        },
    };
}
const TokenSet = zod_1.z.object({
    /** The access token issued by the authorization server. */
    access_token: zod_1.z.string(),
    /** The type of the token issued */
    token_type: zod_1.z.literal("Bearer"),
    /** The lifetime in seconds of the access token. */
    expires_in: zod_1.z.number(),
    /** The refresh token, which can be used to obtain new access tokens. */
    refresh_token: zod_1.z.string().optional(),
    /** The scope of the access token. */
    scope: zod_1.z.string().optional(),
});
const OAuthErrorResponse = zod_1.z.object({
    error: zod_1.z.enum([
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "unsupported_grant_type",
        "invalid_scope",
        "server_error",
        // Device Authorization Response Errors
        "authorization_pending",
        "slow_down",
        "access_denied",
        "expired_token",
        // Revocation Response Errors
        "unsupported_token_type",
    ]),
    error_description: zod_1.z.string().optional(),
    error_uri: zod_1.z.string().optional(),
});
function processOAuthErrorResponse(json) {
    try {
        return OAuthErrorResponse.parse(json);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return new TypeError(`Invalid OAuth error response: ${error.message}`);
        }
        return new TypeError("Failed to parse OAuth error response");
    }
}
class OAuthError extends Error {
    constructor(message, response) {
        super(message);
        this.name = "OAuthError";
        const error = processOAuthErrorResponse(response);
        if (error instanceof TypeError) {
            const message = `Unexpected server response: ${JSON.stringify(response)}`;
            this.cause = new Error(message, { cause: error });
            this.code = "server_error";
            return;
        }
        let cause = error.error;
        if (error.error_description)
            cause += `: ${error.error_description}`;
        if (error.error_uri)
            cause += ` (${error.error_uri})`;
        this.cause = new Error(cause);
        this.code = error.error;
    }
}
function isOAuthError(error) {
    return error instanceof OAuthError;
}
//# sourceMappingURL=oauth.js.map