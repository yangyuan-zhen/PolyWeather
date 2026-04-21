import type { Files } from './types';
/**
 * Collects the total uncompressed size of a set of Lambda files.
 * Handles both FileBlob (in-memory) and FileFsRef (on-disk) file types.
 */
export declare const collectUncompressedSize: (files: Files, ignoreFn?: ((fileKey: string) => boolean) | undefined) => Promise<number>;
