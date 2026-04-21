import type { Files } from '../types';
import { EdgeFunction } from '../edge-function';
import type FileFsRef from '../file-fs-ref';
import type { SerializedEdgeFunction } from './serialized-types';
export declare function deserializeEdgeFunction(files: Files, config: SerializedEdgeFunction, repoRootPath: string, fileFsRefsCache: Map<string, FileFsRef>): Promise<EdgeFunction>;
