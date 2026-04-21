import type { Options as RetryOptions } from "async-retry";
export interface RequestOptions {
    onRetry?(error: any, options: RequestOptions): void;
    retry?: Partial<RetryOptions>;
}
/**
 * Wraps a fetch function with retry logic. The retry logic will retry
 * on network errors, 429 responses and 5xx responses. The retry logic
 * will not retry on 4xx responses.
 *
 * @param rawFetch The fetch function to wrap.
 * @returns The wrapped fetch function.
 */
export declare function withRetry<T extends RequestInit>(rawFetch: (url: URL | string, init?: T) => Promise<Response>): (url: URL | string, opts?: T & RequestOptions) => Promise<Response>;
