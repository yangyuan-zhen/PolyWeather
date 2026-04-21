"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseClient = void 0;
exports.parse = parse;
exports.parseOrThrow = parseOrThrow;
const api_error_1 = require("./api-error");
const array_1 = require("../utils/array");
const with_retry_1 = require("./with-retry");
const undici_1 = require("undici");
/**
 * A base API client that provides a convenience wrapper for fetching where
 * we can pass query parameters as an object, support retries, debugging
 * and automatic authorization.
 */
class BaseClient {
    constructor(params) {
        this.fetch = (0, with_retry_1.withRetry)(params.fetch ?? globalThis.fetch);
        this.baseUrl = params.baseUrl;
        this.debug = params.debug ?? process.env.DEBUG_FETCH === "true";
        this.token = params.token;
        this.agent = new undici_1.Agent({
            bodyTimeout: 0, // disable body timeout to allow long logs streaming
        });
    }
    async request(path, opts) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (opts?.query) {
            for (const [key, value] of Object.entries(opts.query)) {
                (0, array_1.array)(value).forEach((value) => {
                    url.searchParams.append(key, value.toString());
                });
            }
        }
        const start = Date.now();
        const response = await this.fetch(url.toString(), {
            ...opts,
            body: opts?.body,
            method: opts?.method || "GET",
            headers: this.token
                ? { Authorization: `Bearer ${this.token}`, ...opts?.headers }
                : opts?.headers,
            // @ts-expect-error Node.js' and undici's Agent have different types
            dispatcher: this.agent,
            signal: opts?.signal,
        });
        if (this.debug) {
            const duration = Date.now() - start;
            console.log(`[API] ${url} (${response.status}) ${duration}ms`);
            if (response.status === 429) {
                const retry = parseInt(response.headers.get("Retry-After") ?? "", 10);
                const hours = Math.floor(retry / 60 / 60);
                const minutes = Math.floor(retry / 60) % 60;
                const seconds = retry % 60;
                console.warn(`[API] ${url} Rate Limited, Retry After ${hours}h ${minutes}m ${seconds}s`);
            }
        }
        return response;
    }
}
exports.BaseClient = BaseClient;
/**
 * Extract sandboxId from a sandbox API URL.
 * URLs follow the pattern: /v1/sandboxes/{sandboxId}/...
 */
function extractSandboxId(url) {
    const match = url.match(/\/v1\/sandboxes\/([^/?]+)/);
    return match?.[1];
}
/**
 * Allows to read the response text and parse it as JSON casting to the given
 * type. If the response is not ok or cannot be parsed it will return error.
 *
 * @param response Response to parse.
 * @returns Parsed response or error.
 */
async function parse(validator, response) {
    const sandboxId = extractSandboxId(response.url);
    const text = await response.text().catch((err) => {
        return new api_error_1.APIError(response, {
            message: `Can't read response text: ${String(err)}`,
            sandboxId,
        });
    });
    if (typeof text !== "string") {
        return text;
    }
    let json;
    try {
        json = JSON.parse(text || "{}");
    }
    catch (error) {
        return new api_error_1.APIError(response, {
            message: `Can't parse JSON: ${String(error)}`,
            text,
            sandboxId,
        });
    }
    if (!response.ok) {
        return new api_error_1.APIError(response, {
            message: `Status code ${response.status} is not ok`,
            json: json,
            text,
            sandboxId,
        });
    }
    const validated = validator.safeParse(json);
    if (!validated.success) {
        return new api_error_1.APIError(response, {
            message: `Response JSON is not valid: ${validated.error}`,
            json: json,
            text,
            sandboxId,
        });
    }
    return {
        json: validated.data,
        response,
        text,
    };
}
async function parseOrThrow(validator, response) {
    const result = await parse(validator, response);
    if (result instanceof api_error_1.APIError) {
        throw result;
    }
    return result;
}
//# sourceMappingURL=base-client.js.map