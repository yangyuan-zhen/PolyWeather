/**
 * A source of a package in a uv.lock file
 */
export interface UvLockPackageSource {
    registry?: string;
    url?: string;
    git?: string;
    path?: string;
    editable?: string;
    virtual?: string;
}
/**
 * A wheel entry from a uv.lock file.
 */
export interface UvLockWheel {
    url: string;
}
/**
 * A package entry from a parsed uv.lock file.
 */
export interface UvLockPackage {
    name: string;
    version: string;
    source?: UvLockPackageSource;
    wheels: UvLockWheel[];
    dependencies?: Array<{
        name: string;
        marker?: string;
    }>;
}
/**
 * Parsed uv.lock file structure.
 */
export interface UvLockFile {
    version?: number;
    packages: UvLockPackage[];
}
/**
 * Parse the contents of a uv.lock file.
 *
 * @param content - The raw content of the uv.lock file
 * @param path - Optional path to the file for error reporting
 */
export declare function parseUvLock(content: string, path?: string): UvLockFile;
/**
 * Check if a package source indicates it's a private package.
 *
 * Private packages are those from:
 * - Git repositories
 * - Local file paths
 * - Editable installs
 * - Direct URLs
 * - Non-PyPI registry URLs (private PyPI mirrors, custom indexes)
 */
export declare function isPrivatePackageSource(source: UvLockPackageSource | undefined): boolean;
/**
 * Result of classifying packages from a uv.lock file.
 */
export interface PackageClassification {
    privatePackages: string[];
    publicPackages: string[];
    packageVersions: Record<string, string>;
}
/**
 * Normalize a Python package name according to PEP 503.
 */
export declare function normalizePackageName(name: string): string;
/**
 * Options for classifying packages.
 */
export interface ClassifyPackagesOptions {
    lockFile: UvLockFile;
    excludePackages?: string[];
}
/**
 * Classify packages from a uv.lock file into private and public categories.
 *
 * This is used for determining which packages can be installed from PyPI
 * at runtime vs. which must be bundled with the deployment.
 */
export declare function classifyPackages(options: ClassifyPackagesOptions): PackageClassification;
