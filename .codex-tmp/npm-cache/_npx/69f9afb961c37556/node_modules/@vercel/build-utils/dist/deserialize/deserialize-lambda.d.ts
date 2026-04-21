import type { Files } from '../types';
import { Lambda } from '../lambda';
import { NodejsLambda } from '../nodejs-lambda';
import type FileFsRef from '../file-fs-ref';
import type { SerializedLambda, SerializedNodejsLambda } from './serialized-types';
export interface DeserializeLambdaOptions {
    useOnlyStreamingLambda?: boolean;
    forceNodejsStreaming?: boolean;
    /**
     * Custom Lambda class constructor. Defaults to the base Lambda class.
     * Pass an extended class (e.g. with BYOC `external` property) to
     * preserve extra properties through deserialization.
     */
    LambdaClass?: typeof Lambda;
    /**
     * Custom NodejsLambda class constructor. Defaults to the base NodejsLambda class.
     * Pass an extended class (e.g. with BYOC `external` property) to
     * preserve extra properties through deserialization.
     */
    NodejsLambdaClass?: typeof NodejsLambda;
}
export declare function deserializeLambda(files: Files, config: SerializedLambda | SerializedNodejsLambda, repoRootPath: string, fileFsRefsCache: Map<string, FileFsRef>, options?: DeserializeLambdaOptions): Promise<Lambda>;
