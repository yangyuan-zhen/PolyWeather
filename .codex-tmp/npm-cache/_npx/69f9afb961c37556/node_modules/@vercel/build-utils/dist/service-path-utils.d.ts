/**
 * Shared utilities for generating internal service paths.
 *
 * These are used by builders (e.g. @vercel/python) to produce cron entries
 * and rewrite routes for service builds.
 */
/**
 * Reserved internal namespace used by services routing/runtime plumbing.
 */
export declare const INTERNAL_SERVICE_PREFIX = "/_svc";
export declare function getInternalServiceFunctionPath(serviceName: string): string;
export declare function getInternalServiceCronPathPrefix(serviceName: string): string;
export declare function getInternalServiceCronPath(serviceName: string, entrypoint: string, handler?: string): string;
