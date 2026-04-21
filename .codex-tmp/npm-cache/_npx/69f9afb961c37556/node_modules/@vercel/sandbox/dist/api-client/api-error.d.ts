interface Options<ErrorData> {
    message?: string;
    json?: ErrorData;
    text?: string;
    sandboxId?: string;
}
export declare class APIError<ErrorData> extends Error {
    response: Response;
    message: string;
    json?: ErrorData;
    text?: string;
    sandboxId?: string;
    constructor(response: Response, options?: Options<ErrorData>);
}
/**
 * Error thrown when a stream error is received streaming.
 * This typically occurs when the sandbox is stopped while streaming.
 */
export declare class StreamError extends Error {
    code: string;
    sandboxId: string;
    constructor(code: string, message: string, sandboxId: string);
}
export {};
