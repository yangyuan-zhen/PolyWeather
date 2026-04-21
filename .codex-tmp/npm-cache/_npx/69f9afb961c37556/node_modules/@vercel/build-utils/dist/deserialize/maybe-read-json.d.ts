/**
 * Reads the JSON file at `path`.
 * Returns `undefined` if the file does not exist.
 */
export declare function maybeReadJSON<T = any>(path: string): Promise<T | undefined>;
