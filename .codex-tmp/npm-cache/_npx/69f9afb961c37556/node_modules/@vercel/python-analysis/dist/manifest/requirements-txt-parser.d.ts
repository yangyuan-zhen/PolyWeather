import type { PyProjectToml } from './pyproject/types';
import type { NormalizedRequirement } from './requirement/types';
import type { ReadFileFn } from '../wasm/host-utils';
/**
 * Parsed pip arguments from requirements file.
 */
export interface PipOptions {
    /** Primary index URL (--index-url or -i) - only the last one is kept */
    indexUrl?: string;
    /** Extra index URLs (--extra-index-url) */
    extraIndexUrls: string[];
    /** Directories/URLs for --find-links / -f (only set when present) */
    findLinks?: string[];
    /** Whether --no-index was specified (only set when true) */
    noIndex?: boolean;
}
/**
 * Result of parsing a requirements file with pip options.
 */
export interface ParsedRequirementsFile {
    requirements: NormalizedRequirement[];
    pipOptions: PipOptions;
}
/**
 * Options for parsing requirements files.
 */
export interface ParseRequirementsOptions {
    /** Function to read referenced requirement files (-r, -c). */
    readFile?: ReadFileFn;
    /** Directory containing the requirements file, used for resolving relative paths. */
    workingDir?: string;
    /**
     * Package root directory (where pyproject.toml lives).
     * When set and different from workingDir, source paths are rebased
     * relative to this directory in convertRequirementsToPyprojectToml.
     */
    packageRoot?: string;
}
/**
 * Convert a requirements.txt content to a pyproject.toml object suitable for uv.
 */
export declare function convertRequirementsToPyprojectToml(fileContent: string, options?: ParseRequirementsOptions): Promise<PyProjectToml>;
/**
 * Parse requirements file content with full pip options support.
 * The upstream WASM parser handles -r/-c recursion natively via the host-bridge.
 */
export declare function parseRequirementsFile(fileContent: string, options?: ParseRequirementsOptions): Promise<ParsedRequirementsFile>;
export type { ReadFileFn };
