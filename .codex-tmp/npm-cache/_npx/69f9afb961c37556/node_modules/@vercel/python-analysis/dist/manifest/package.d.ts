import type { RelPath } from '../util/fs';
import type { PyProjectToml } from './pyproject/types';
import type { PythonConstraint, PythonRequest } from './python-specifiers';
/**
 * Kinds of Python configuration files that can be discovered.
 *
 * These are standalone configuration files (not package manifests)
 * that affect Python version selection or runtime behavior.
 */
export declare enum PythonConfigKind {
    /** `.python-version` file specifying the Python version to use. */
    PythonVersion = ".python-version"
}
/**
 * Kinds of native Python package manifests.
 *
 * These are standard Python packaging formats that don't require conversion.
 */
export declare enum PythonManifestKind {
    /** Standard `pyproject.toml` file (PEP 517/518/621). */
    PyProjectToml = "pyproject.toml"
}
/**
 * Kinds of Python lock files.
 *
 * Lock files pin exact dependency versions for reproducible installs.
 */
export declare enum PythonLockFileKind {
    /** uv's lock file format. */
    UvLock = "uv.lock",
    /** PEP 751 standard lock file format. */
    PylockToml = "pylock.toml"
}
/**
 * Information about a detected lock file.
 */
export interface PythonLockFile {
    /** Relative path to the lock file. */
    path: RelPath;
    /** The lock file format. */
    kind: PythonLockFileKind;
}
/**
 * Kinds of Python package manifests that are converted to pyproject.toml format.
 *
 * These legacy or alternative formats are parsed and converted to a normalized
 * pyproject.toml representation for consistent handling.
 */
export declare enum PythonManifestConvertedKind {
    /** Pipenv's `Pipfile` manifest. */
    Pipfile = "Pipfile",
    /** Pipenv's `Pipfile.lock` lockfile. */
    PipfileLock = "Pipfile.lock",
    /** pip-tools' `requirements.in` input file. */
    RequirementsIn = "requirements.in",
    /** Standard pip `requirements.txt` file. */
    RequirementsTxt = "requirements.txt"
}
/**
 * Tracks the original source of a converted manifest.
 *
 * When a manifest is converted from a non-pyproject.toml format,
 * this records the original file type and path for reference.
 */
export interface PythonManifestOrigin {
    /** The kind of the original manifest file. */
    kind: PythonManifestKind | PythonManifestConvertedKind;
    /** Relative path to the original manifest file. */
    path: RelPath;
}
/**
 * A Python package manifest in normalized pyproject.toml format.
 *
 * This may represent either a native pyproject.toml file or a converted
 * manifest from another format (Pipfile, requirements.txt, etc.).
 */
export interface PythonManifest {
    /** Relative path to the manifest file. */
    path: RelPath;
    /** Parsed manifest data in pyproject.toml structure. */
    data: PyProjectToml;
    /** Origin information if this was converted from another format. */
    origin?: PythonManifestOrigin;
    /** Whether this manifest represents a workspace root. */
    isRoot?: boolean;
    /** Lock file associated with this manifest, if one exists. */
    lockFile?: PythonLockFile;
}
/**
 * Configuration from a `.python-version` file.
 *
 * Contains parsed Python version requests that can be used to
 * determine which Python version to use for the project.
 */
export interface PythonVersionConfig {
    kind: PythonConfigKind.PythonVersion;
    /** Relative path to the .python-version file. */
    path: RelPath;
    /** Parsed Python version requests from the file. */
    data: PythonRequest[];
    /** Raw version string from the file (e.g. "3.12", ">=3.12,<3.13"). */
    specifier: string;
}
/**
 * Union type for all Python configuration file types.
 *
 * Currently only includes `.python-version`, but can be extended
 * to support additional configuration file types.
 */
export type PythonConfig = PythonVersionConfig;
/**
 * Helper type to create a discriminated record from a union type.
 * Maps each discriminator value to its corresponding union member.
 *
 * This creates a lookup table where the keys are the possible values of
 * property `P` in the union `PythonConfig`, and the values are the specific
 * union members that have that property value.
 *
 * @example
 * // Given:
 * type Config = { kind: 'a'; dataA: string } | { kind: 'b'; dataB: number };
 *
 * // PythonConfigDiscriminatedRecord<Config, 'kind'> produces:
 * // {
 * //   'a': { kind: 'a'; dataA: string };
 * //   'b': { kind: 'b'; dataB: number };
 * // }
 *
 * @typeParam PythonConfig - A union type with a discriminant property
 * @typeParam P - The key of the discriminant property (e.g., 'kind')
 */
type PythonConfigDiscriminatedRecord<PythonConfig extends Record<P, PropertyKey>, P extends keyof PythonConfig> = {
    [K in PythonConfig[P]]: Extract<PythonConfig, Record<P, K>>;
};
/**
 * A partial record of Python configuration files keyed by their kind.
 *
 * Used to store discovered configuration files at each directory level
 * during package discovery.
 */
export type PythonConfigs = Partial<PythonConfigDiscriminatedRecord<PythonConfig, 'kind'>>;
/**
 * Complete information about a discovered Python package.
 *
 * Contains the package manifest, associated configuration files,
 * Python version requirements, and workspace information.
 */
export interface PythonPackage {
    /** The package's manifest (pyproject.toml or converted equivalent). */
    manifest?: PythonManifest;
    /** Configuration files discovered between the package and workspace root. */
    configs?: PythonConfigs[];
    /** Python version constraints from various sources. */
    requiresPython?: PythonConstraint[];
    /** The workspace root manifest, if this package is part of a workspace. */
    workspaceManifest?: PythonManifest;
    /** Lock file at the workspace root, if one exists. */
    workspaceLockFile?: PythonLockFile;
}
/**
 * Discover Python package information starting from an entrypoint directory.
 *
 * Walks up the directory tree from `entrypointDir` to `rootDir`, collecting:
 * - Python manifests (pyproject.toml, Pipfile, requirements.txt, etc.)
 * - Python configuration files (.python-version)
 * - Workspace relationships between packages
 *
 * The discovery process:
 * 1. Starts at the entrypoint directory and walks up to the root
 * 2. At each level, looks for manifests and configuration files
 * 3. Stops when it finds a workspace root or reaches the repository root
 * 4. Computes Python version requirements from all discovered sources
 *
 * @param entrypointDir - Directory containing the Python entrypoint file
 * @param rootDir - Repository root directory (discovery boundary)
 * @returns Discovered package information including manifest, configs, and constraints
 *
 * @throws {Error} If entrypointDir is outside of rootDir
 *
 * @example
 * const pkg = await discoverPythonPackage({
 *   entrypointDir: '/repo/packages/myapp',
 *   rootDir: '/repo',
 * });
 * // pkg.manifest contains the package's pyproject.toml data
 * // pkg.requiresPython contains Python version constraints
 */
export declare function discoverPythonPackage({ entrypointDir, rootDir, }: {
    entrypointDir: string;
    rootDir: string;
}): Promise<PythonPackage>;
export {};
