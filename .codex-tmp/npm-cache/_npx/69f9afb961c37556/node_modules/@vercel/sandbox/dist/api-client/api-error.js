"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamError = exports.APIError = void 0;
class APIError extends Error {
    constructor(response, options) {
        super(response.statusText);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, APIError);
        }
        this.response = response;
        this.message = options?.message ?? "";
        this.json = options?.json;
        this.text = options?.text;
        this.sandboxId = options?.sandboxId;
    }
}
exports.APIError = APIError;
/**
 * Error thrown when a stream error is received streaming.
 * This typically occurs when the sandbox is stopped while streaming.
 */
class StreamError extends Error {
    constructor(code, message, sandboxId) {
        super(message);
        this.name = "StreamError";
        this.code = code;
        this.sandboxId = sandboxId;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, StreamError);
        }
    }
}
exports.StreamError = StreamError;
//# sourceMappingURL=api-error.js.map