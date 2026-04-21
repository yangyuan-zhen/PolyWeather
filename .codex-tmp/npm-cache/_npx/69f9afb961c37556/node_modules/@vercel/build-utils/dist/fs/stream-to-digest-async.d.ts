/// <reference types="node" />
/// <reference types="node" />
export interface FileDigest {
    md5: string;
    sha256: string;
    size: number;
}
export declare function streamToDigestAsync(stream: NodeJS.ReadableStream): Promise<FileDigest>;
export declare function sha256(value: any): string;
export declare function md5(value: Buffer): string;
