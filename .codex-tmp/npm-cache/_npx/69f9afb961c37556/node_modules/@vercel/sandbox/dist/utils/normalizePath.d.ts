/**
 * Normalize a path and make it relative to `params.extractDir` for inclusion
 * in our tar archives.
 *
 * Relative paths are first resolved to `params.cwd`.
 * Absolute paths are normalized and resolved relative to `params.extractDir`.
 *
 * In addition, paths are normalized so consecutive slashes are removed and
 * stuff like `../..` is resolved appropriately.
 *
 * This function always returns a path relative to `params.extractDir`.
 */
export declare function normalizePath(params: {
    filePath: string;
    cwd: string;
    extractDir: string;
}): string;
