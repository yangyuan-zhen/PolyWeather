import type { Service } from './types';
type Envs = {
    [key: string]: string | undefined;
};
interface FrameworkInfo {
    slug: string | null;
    envPrefix?: string;
}
export interface GetServiceUrlEnvVarsOptions {
    services: Service[];
    frameworkList: readonly FrameworkInfo[];
    currentEnv?: Envs;
    deploymentUrl?: string;
    origin?: string;
    envPrefix?: string;
}
/**
 * Generate environment variables for service URLs.
 *
 * For each web service, generates:
 * 1. A base env var with the full absolute URL (e.g., BACKEND_URL=https://deploy.vercel.app/api)
 *    for server-side use.
 * 2. Framework-prefixed versions with only the route prefix path
 *    (e.g., NEXT_PUBLIC_BACKEND_URL=/api, VITE_BACKEND_URL=/api) for client-side use.
 *    Using relative paths avoids CORS issues since the browser resolves them against
 *    the current origin, which works correctly across production domains, preview
 *    deployments, and custom domains.
 *
 * Environment variables that are already set in `currentEnv` will NOT be overwritten,
 * allowing user-defined values to take precedence.
 */
export declare function getServiceUrlEnvVars(options: GetServiceUrlEnvVarsOptions): Record<string, string>;
export {};
