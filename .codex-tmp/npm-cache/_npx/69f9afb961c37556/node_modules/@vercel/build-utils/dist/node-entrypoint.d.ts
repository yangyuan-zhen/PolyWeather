import type FileFsRef from './file-fs-ref';
/**
 * Check if a Node.js/TypeScript file is a valid API entrypoint by detecting
 * export patterns that correspond to supported handler shapes:
 * - Default function export (req, res handler)
 * - Named HTTP method exports (GET, POST, etc.)
 * - Fetch export
 * - module.exports / exports assignments
 *
 * Returns `true` on error as a safe default — if we can't read the file,
 * let the existing build pipeline handle it.
 */
export declare function isNodeEntrypoint(file: FileFsRef | {
    fsPath?: string;
}): Promise<boolean>;
