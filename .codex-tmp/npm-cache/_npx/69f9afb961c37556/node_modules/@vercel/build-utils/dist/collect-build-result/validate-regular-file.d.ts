/// <reference types="node" />
import type FileFsRef from '../file-fs-ref';
import { type Stats } from 'fs-extra';
interface FileLike {
    fsPath?: string;
}
export declare function validateRegularFile(file: FileFsRef): Promise<Stats>;
export declare function validateRegularFile<T extends object>(file: FileLike | T): Promise<Stats | null>;
export {};
