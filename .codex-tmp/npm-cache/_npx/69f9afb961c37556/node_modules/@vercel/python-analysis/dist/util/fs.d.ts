/// <reference types="node" />
/** Absolute filesystem path. */
export type AbsPath = string;
/** Relative filesystem path. */
export type RelPath = string;
/** Any filesystem path */
export type Path = AbsPath | RelPath;
export declare function readFileIfExists(file: Path): Promise<Buffer | null>;
export declare function readFileTextIfExists(file: Path, encoding?: BufferEncoding): Promise<string | null>;
export declare function normalizePath(p: Path): AbsPath;
/**
 * Check if a path is at or below a parent path in the directory tree.
 *
 * @param somePath - The path to check
 * @param parentPath - The potential parent/ancestor path
 * @returns True if `somePath` is equal to `parentPath` or is a subdirectory
 *          of `parentPath`.
 *
 * @example
 * isSubpath('/a/b/c', '/a/b') // true - c is under b
 * isSubpath('/a/b', '/a/b')   // true - same path
 * isSubpath('/a/b', '/a/b/c') // false - b is above c
 * isSubpath('/a/x', '/a/b')   // false - x is not under b
 */
export declare function isSubpath(somePath: Path, parentPath: Path): boolean;
