/// <reference types="node" />
/**
 * Host-side implementation of the `vercel:python-analysis/host-utils` WIT interface.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * Function type for reading referenced requirement files.
 */
export type ReadFileFn = (path: string) => string | null;
export interface ReadFileContext {
    readFile: ReadFileFn;
    workingDir?: string;
}
export declare const readFileStorage: AsyncLocalStorage<ReadFileContext>;
export declare function createHostUtils(): {
    readFile(path: string): string;
    domainToAscii(domain: string): string;
    domainToUnicode(domain: string): [string, boolean];
    nfcNormalize(s: string): string;
    nfdNormalize(s: string): string;
    nfkcNormalize(s: string): string;
    nfkdNormalize(s: string): string;
};
