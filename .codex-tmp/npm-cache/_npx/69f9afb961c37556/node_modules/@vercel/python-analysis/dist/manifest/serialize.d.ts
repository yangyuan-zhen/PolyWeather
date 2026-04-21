import type { PyProjectToml } from './pyproject/types';
/**
 * Serialize a PyProjectToml to TOML string format.
 */
export declare function stringifyManifest(data: PyProjectToml): string;
/**
 * Options for creating a minimal pyproject.toml structure.
 */
export interface CreateMinimalManifestOptions {
    /** Project name (defaults to 'app'). */
    name?: string;
    /** Project version (defaults to '0.1.0'). */
    version?: string;
    /** Python version constraint (e.g., '>=3.12' or '~=3.12.0'). */
    requiresPython?: string;
    /** Initial dependencies. */
    dependencies?: string[];
}
/**
 * Create a minimal PyProjectToml structure for projects without a manifest.
 */
export declare function createMinimalManifest(options?: CreateMinimalManifestOptions): PyProjectToml;
