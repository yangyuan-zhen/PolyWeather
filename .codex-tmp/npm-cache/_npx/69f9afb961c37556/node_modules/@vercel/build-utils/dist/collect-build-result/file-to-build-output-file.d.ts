import type { FileDigest } from '../fs/stream-to-digest-async';
import type FileFsRef from '../file-fs-ref';
import type FileRef from '../file-ref';
import type FileBlob from '../file-blob';
export interface BuildOutputFile {
    contentType?: string;
    digest: string;
    lambda: null;
    mode: number;
    path: string;
    paths?: string[];
    size?: number;
    type?: 'file';
    prerenderPath?: string;
}
export declare function fileToBuildOutputFile(params: {
    buildResult: FileBlob | FileFsRef | FileRef;
    extendedBody?: {
        prefix: string;
        suffix: string;
    };
    outputPath: string;
}): Promise<{
    output: BuildOutputFile;
    digest: FileDigest;
}>;
