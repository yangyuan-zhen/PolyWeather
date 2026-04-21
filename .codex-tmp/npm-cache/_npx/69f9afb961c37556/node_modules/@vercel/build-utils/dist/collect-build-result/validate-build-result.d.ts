import type { BuildResultV2Typical, BuildResultV3, BuilderFunctions, Config } from '../types';
export declare const SUPPORTED_AL2023_RUNTIMES: readonly ["nodejs20.x", "nodejs22.x", "nodejs24.x", "provided.al2023", "python3.12", "python3.13", "python3.14", "ruby3.3", "bun1.x", "executable"];
type BuildConfigWithVercelConfig = Config & {
    vercelConfig?: {
        functions?: BuilderFunctions;
    };
};
export interface ValidateBuildResultParams {
    allowInvalidRuntime?: boolean;
    buildConfig?: BuildConfigWithVercelConfig;
    buildResponse: BuildResultV2Typical | BuildResultV3;
    osRelease?: OsRelease | null;
    vercelBaseUrl?: string;
}
export interface ValidateBuildResultResult {
    buildOutputMap: BuildResultV2Typical['output'];
    customFunctionConfiguration?: BuilderFunctions[string];
}
type OsRelease = Record<string, string>;
export declare function validateBuildResult({ allowInvalidRuntime, buildConfig, buildResponse, osRelease, vercelBaseUrl, }: ValidateBuildResultParams): Promise<ValidateBuildResultResult>;
export {};
