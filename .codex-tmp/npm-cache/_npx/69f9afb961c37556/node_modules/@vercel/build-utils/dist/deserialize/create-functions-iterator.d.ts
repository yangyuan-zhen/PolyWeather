/**
 * Creates an async iterator that scans a directory for sub-directories
 * that end with the suffix `.func`.
 *
 * @param dir Absolute path to scan for `.func` directories
 * @param root The root directory from where the scanning started
 */
export declare function createFunctionsIterator(dir: string, root?: string): AsyncIterable<string>;
