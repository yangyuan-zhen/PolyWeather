/**
 * Python specifier types for version, implementation, variant, and build information.
 *
 * These types are used internally for Python version selection and are not
 * parsed from config files (no Zod schemas needed).
 *
 * @module python-specifiers
 */
import type { Pep440Constraint } from '@renovatebot/pep440';
export type UnknownPythonImplementation = {
    implementation: string;
};
export type PythonImplementation = 'cpython' | 'pypy' | 'pyodide' | 'graalpy' | UnknownPythonImplementation;
export declare const PythonImplementation: {
    knownLongNames(): Record<string, PythonImplementation>;
    knownShortNames(): Record<string, PythonImplementation>;
    knownNames(): Record<string, PythonImplementation>;
    parse(s: string): PythonImplementation;
    isUnknown(impl: PythonImplementation): impl is UnknownPythonImplementation;
    toString(impl: PythonImplementation): string;
    toStringPretty(impl: PythonImplementation): string;
};
export type PythonVariant = 'default' | 'debug' | 'freethreaded' | 'gil' | 'freethreaded+debug' | 'gil+debug' | {
    type: 'unknown';
    variant: string;
};
export declare const PythonVariant: {
    parse(s: string): PythonVariant;
    toString(v: PythonVariant): string;
};
export interface PythonRequest {
    implementation?: PythonImplementation;
    version?: PythonVersionRequest;
    platform?: PythonPlatformRequest;
}
export interface PythonPlatformRequest {
    os?: string;
    arch?: string;
    libc?: string;
}
export interface PythonVersionRequest {
    constraint: Pep440Constraint[];
    variant?: PythonVariant;
}
/**
 * A Python version constraint with its source.
 *
 * Represents a requirement for a specific Python version range,
 * along with information about where the constraint originated.
 */
export interface PythonConstraint {
    /** The Python version request(s) that define this constraint. */
    request: PythonRequest[];
    /** Config file name where this constraint originated (e.g. "pyproject.toml", ".python-version"). */
    source: string;
    /** Human-readable description of where this constraint came from. */
    prettySource: string;
    /** Raw version specifier string from the source file (e.g. ">=3.12", "3.12"). */
    specifier?: string;
}
export type PythonVersion = {
    major: number;
    minor: number;
    patch?: number;
    prerelease?: string;
};
export declare const PythonVersion: {
    toString(version: PythonVersion): string;
};
export type PythonBuild = {
    version: PythonVersion;
    implementation: PythonImplementation;
    variant: PythonVariant;
    os: string;
    architecture: string;
    libc: string;
};
export declare const PythonBuild: {
    toString(build: PythonBuild): string;
};
