import type { Options as RetryOptions } from "async-retry";
import { APIError } from "./api-error";
import { ZodType } from "zod";
import { type RequestOptions } from "./with-retry";
export interface RequestParams extends RequestInit {
    headers?: Record<string, string>;
    method?: string;
    onRetry?(error: any, options: RequestOptions): void;
    query?: Record<string, number | string | null | undefined | string[]>;
    retry?: Partial<RetryOptions>;
}
/**
 * A base API client that provides a convenience wrapper for fetching where
 * we can pass query parameters as an object, support retries, debugging
 * and automatic authorization.
 */
export declare class BaseClient {
    protected token?: string;
    private fetch;
    private debug;
    private baseUrl;
    private agent;
    constructor(params: {
        debug?: boolean;
        baseUrl: string;
        token?: string;
        fetch?: typeof globalThis.fetch;
    });
    protected request(path: string, opts?: RequestParams): Promise<Response>;
}
export interface Parsed<Data> {
    response: Response;
    text: string;
    json: Data;
}
/**
 * Allows to read the response text and parse it as JSON casting to the given
 * type. If the response is not ok or cannot be parsed it will return error.
 *
 * @param response Response to parse.
 * @returns Parsed response or error.
 */
export declare function parse<Data, ErrorData>(validator: ZodType<Data>, response: Response): Promise<Parsed<Data> | APIError<ErrorData>>;
export declare function parseOrThrow<Data, ErrorData>(validator: ZodType<Data>, response: Response): Promise<Parsed<Data>>;
