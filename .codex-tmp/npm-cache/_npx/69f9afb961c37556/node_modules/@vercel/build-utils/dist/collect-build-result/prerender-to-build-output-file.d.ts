import type { FileDigest } from '../fs/stream-to-digest-async';
import type { Prerender } from '../prerender';
import type { File } from '../types';
import { type BuildOutputFile } from './file-to-build-output-file';
interface PrerenderToBuildOutputFileResult {
    digest: FileDigest;
    extended: ExtendedPayload;
    file: File;
    output: BuildOutputFile;
}
export declare function prerenderToBuildOutputFile(params: {
    buildResult: Prerender;
    outputPath: string;
}): Promise<PrerenderToBuildOutputFileResult | null>;
export interface ExtendedPayload {
    extendedBody: {
        prefix: string;
        suffix: string;
    } | undefined;
    fallback?: File | null;
    initialHeaders: Record<string, string> | undefined;
}
export {};
