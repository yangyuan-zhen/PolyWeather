"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollForToken = pollForToken;
const promises_1 = require("node:timers/promises");
const file_1 = require("./file");
const oauth_1 = require("./oauth");
async function* pollForToken({ request, oauth, }) {
    const controller = new AbortController();
    try {
        let intervalMs = request.interval * 1000;
        while (Date.now() < request.expiresAt) {
            const [tokenResponseError, tokenResponse] = await oauth.deviceAccessTokenRequest(request.device_code);
            if (tokenResponseError) {
                // 2x backoff on connection timeouts per spec https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
                if (tokenResponseError.message.includes("timeout")) {
                    intervalMs *= 2;
                    yield { _tag: "Timeout", newInterval: intervalMs };
                    await (0, promises_1.setTimeout)(intervalMs, { signal: controller.signal });
                    continue;
                }
                yield { _tag: "Error", error: tokenResponseError };
                return;
            }
            yield {
                _tag: "Response",
                response: tokenResponse.clone(),
            };
            const [tokensError, tokens] = await oauth.processTokenResponse(tokenResponse);
            if ((0, oauth_1.isOAuthError)(tokensError)) {
                const { code } = tokensError;
                switch (code) {
                    case "authorization_pending":
                        await (0, promises_1.setTimeout)(intervalMs, { signal: controller.signal });
                        continue;
                    case "slow_down":
                        intervalMs += 5 * 1000;
                        yield { _tag: "SlowDown", newInterval: intervalMs };
                        await (0, promises_1.setTimeout)(intervalMs, { signal: controller.signal });
                        continue;
                    default:
                        yield { _tag: "Error", error: tokensError.cause };
                        return;
                }
            }
            if (tokensError) {
                yield { _tag: "Error", error: tokensError };
                return;
            }
            (0, file_1.updateAuthConfig)({
                token: tokens.access_token,
                expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
                refreshToken: tokens.refresh_token,
            });
            return;
        }
        yield {
            _tag: "Error",
            error: new Error("Timed out waiting for authentication. Please try again."),
        };
        return;
    }
    finally {
        controller.abort();
    }
}
//# sourceMappingURL=poll-for-token.js.map