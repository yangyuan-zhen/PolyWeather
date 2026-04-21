import type { Pep440Constraint } from './pep440';
import type { PythonBuild, PythonConstraint, PythonRequest, PythonVariant, PythonVersion } from './python-specifiers';
import { PythonImplementation } from './python-specifiers';
/**
 * Result of selecting a Python build.
 */
export interface PythonSelectionResult {
    /** The selected build, or null if no build matches. */
    build: PythonBuild | null;
    /** Error messages if selection failed. */
    errors?: string[];
    /** Warning messages (e.g., non-overlapping constraints). */
    warnings?: string[];
}
/**
 * Select the best Python build that matches all constraints.
 *
 * @param constraints - Array of Python constraints from various sources
 * @param available - Array of available Python builds to choose from
 * @returns The first matching build, or null with errors/warnings if none match
 */
export declare function selectPython(constraints: PythonConstraint[], available: PythonBuild[]): PythonSelectionResult;
/**
 * Result of the higher-level selectPythonVersion function.
 */
export interface PythonVersionSelectionResult {
    /** The selected build. Falls back to defaultBuild if no constraints match. */
    build: PythonBuild;
    /** Source file where the constraint originated (e.g. "pyproject.toml"). */
    source?: string;
    /** Diagnostic indicating the constraint was found but the build isn't in availableBuilds. */
    notAvailable?: {
        build: PythonBuild;
        /** The version string of the unavailable build. */
        version: string;
    };
    /** Diagnostic indicating no build matches the constraint at all. */
    invalidConstraint?: {
        /** Human-readable version string from the constraint. */
        versionString: string;
    };
}
/**
 * Higher-level Python version selection with two-pass matching and diagnostics.
 *
 * First tries to match constraints against availableBuilds. If no match,
 * tries against allBuilds to produce diagnostic information. Falls back
 * to defaultBuild if no constraints are provided or no match is found.
 */
export declare function selectPythonVersion({ constraints, availableBuilds, allBuilds, defaultBuild, majorMinorOnly, legacyTildeEquals, }: {
    constraints?: PythonConstraint[];
    availableBuilds: PythonBuild[];
    allBuilds: PythonBuild[];
    defaultBuild: PythonBuild;
    majorMinorOnly?: boolean;
    /**
     * When true, treat 2-part compatible-release specifiers (`~=X.Y`) as
     * pinning to exactly that minor version (`==X.Y.*`) rather than the
     * PEP 440 correct `>=X.Y, <(X+1).0`.  This preserves the historical
     * behaviour of the Python builder prior to the python-analysis migration.
     */
    legacyTildeEquals?: boolean;
}): PythonVersionSelectionResult;
/**
 * Convert a PythonVersion to a string suitable for PEP 440 comparison.
 *
 * @param version - The Python version object to convert
 * @returns A version string like "3.12", "3.12.1", or "3.13.0a1"
 *
 * @example
 * pythonVersionToString({ major: 3, minor: 12 }) // "3.12"
 * pythonVersionToString({ major: 3, minor: 12, patch: 1 }) // "3.12.1"
 * pythonVersionToString({ major: 3, minor: 13, patch: 0, prerelease: "a1" }) // "3.13.0a1"
 */
export declare function pythonVersionToString(version: PythonVersion): string;
/**
 * Convert an array of Pep440Constraint to a specifier string.
 *
 * @param constraints - Array of PEP 440 version constraints
 * @returns A comma-separated specifier string like ">=3.12,<3.14"
 *
 * @example
 * pep440ConstraintsToString([{ operator: '>=', version: '3.12', prefix: '' }]) // ">=3.12"
 * pep440ConstraintsToString([
 *   { operator: '>=', version: '3.12', prefix: '' },
 *   { operator: '<', version: '3.14', prefix: '' }
 * ]) // ">=3.12,<3.14"
 */
export declare function pep440ConstraintsToString(constraints: Pep440Constraint[]): string;
/**
 * Check if two PythonImplementation values are equal.
 *
 * Handles both known implementations (cpython, pypy, etc.) and unknown
 * implementations (custom strings). Known implementations are compared
 * by identity, unknown implementations by their string value.
 *
 * @param buildImpl - The implementation of the available build
 * @param requestImpl - The implementation requested by the constraint
 * @returns True if the implementations match
 *
 * @example
 * implementationsMatch('cpython', 'cpython') // true
 * implementationsMatch('cpython', 'pypy') // false
 * implementationsMatch({ implementation: 'custom' }, { implementation: 'custom' }) // true
 */
export declare function implementationsMatch(buildImpl: PythonImplementation, requestImpl: PythonImplementation): boolean;
/**
 * Check if two PythonVariant values are equal.
 *
 * Handles both known variants (default, debug, freethreaded, etc.) and
 * unknown variants. Known variants are compared by identity, unknown
 * variants by their string value.
 *
 * @param buildVariant - The variant of the available build
 * @param requestVariant - The variant requested by the constraint
 * @returns True if the variants match
 *
 * @example
 * variantsMatch('default', 'default') // true
 * variantsMatch('freethreaded', 'debug') // false
 * variantsMatch({ type: 'unknown', variant: 'custom' }, { type: 'unknown', variant: 'custom' }) // true
 */
export declare function variantsMatch(buildVariant: PythonVariant, requestVariant: PythonVariant): boolean;
/**
 * Check if a build matches a single PythonRequest.
 *
 * A build matches a request if all specified fields in the request match
 * the corresponding fields in the build. Unspecified fields in the request
 * are treated as wildcards (match anything).
 *
 * @param build - The available Python build to check
 * @param request - The Python request specifying desired properties
 * @returns True if the build satisfies all specified requirements in the request
 *
 * @example
 * // Request with only version constraint
 * buildMatchesRequest(build, { version: { constraint: [{ operator: '>=', version: '3.12', prefix: '' }] } })
 *
 * // Request with implementation and platform
 * buildMatchesRequest(build, { implementation: 'cpython', platform: { os: 'linux' } })
 */
export declare function buildMatchesRequest(build: PythonBuild, request: PythonRequest): boolean;
/**
 * Check if a build matches a PythonConstraint.
 *
 * A constraint contains one or more requests combined with OR logic.
 * The constraint is satisfied if the build matches at least one of its requests.
 * An empty request array is treated as "match anything".
 *
 * @param build - The available Python build to check
 * @param constraint - The constraint containing one or more requests
 * @returns True if the build matches at least one request in the constraint
 *
 * @example
 * // Constraint with multiple alternative requests (OR logic)
 * buildMatchesConstraint(build, {
 *   request: [
 *     { implementation: 'cpython', version: { constraint: [...] } },
 *     { implementation: 'pypy', version: { constraint: [...] } }
 *   ],
 *   source: '.python-version'
 * })
 */
export declare function buildMatchesConstraint(build: PythonBuild, constraint: PythonConstraint): boolean;
