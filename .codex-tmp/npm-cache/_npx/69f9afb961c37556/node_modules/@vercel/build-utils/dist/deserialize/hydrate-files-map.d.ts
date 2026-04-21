import type { Files } from '../types';
import FileFsRef from '../file-fs-ref';
export declare function hydrateFilesMap(files: Files, filesMap: Record<string, string>, repoRootPath: string, fileFsRefsCache: Map<string, FileFsRef>): Promise<void>;
