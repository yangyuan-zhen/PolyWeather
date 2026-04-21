import { Builder } from '.';
/**
 * List of backend frameworks supported by the experimental backends feature
 */
export declare const BACKEND_FRAMEWORKS: readonly ["express", "hono", "h3", "koa", "nestjs", "fastify", "elysia"];
export declare const PYTHON_FRAMEWORKS: readonly ["fastapi", "flask", "django", "python", "fasthtml"];
export declare const RUNTIME_FRAMEWORKS: readonly ["python"];
/**
 * List of framework-specific backend builders that get replaced by UNIFIED_BACKEND_BUILDER
 * when experimental backends is enabled
 */
export declare const BACKEND_BUILDERS: readonly ["@vercel/express", "@vercel/hono", "@vercel/h3", "@vercel/koa", "@vercel/nestjs", "@vercel/fastify", "@vercel/elysia"];
/**
 * The unified backend builder that replaces framework-specific backend builders
 */
export declare const UNIFIED_BACKEND_BUILDER: "@vercel/backends";
export type BackendFramework = (typeof BACKEND_FRAMEWORKS)[number];
export type PythonFramework = (typeof PYTHON_FRAMEWORKS)[number];
/**
 * Checks if the given framework is a backend framework
 * TODO: make this function generic to all runtimes' backend frameworks and
 * update callers to use isNodeBackendFramework for Node-specific frameworks.
 */
export declare function isBackendFramework(framework: string | null | undefined): framework is BackendFramework;
export declare function isNodeBackendFramework(framework: string | null | undefined): framework is BackendFramework;
export declare function isPythonFramework(framework: string | null | undefined): framework is (typeof PYTHON_FRAMEWORKS)[number];
export declare function isExperimentalBackendsWithoutIntrospectionEnabled(): boolean;
export declare function isExperimentalBackendsEnabled(): boolean;
export declare function isBackendBuilder(builder: Builder | null | undefined): boolean;
/**
 * Checks if experimental backends are enabled AND the framework is a backend framework
 */
export declare function shouldUseExperimentalBackends(framework: string | null | undefined): boolean;
