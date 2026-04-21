export interface BytecodeCachingOptions {
    vercelEnv: string | undefined;
    useBytecodeCaching: string | undefined;
    useNativeBytecodeCaching: string | undefined;
    bytecodeCachingThreshold: string | undefined;
}
interface LambdaLike {
    framework?: {
        slug: string;
    };
    runtime: string;
    shouldAddSourcemapSupport?: boolean;
}
/**
 * Returns an array of scripts that should be preloaded in Node.js Lambdas.
 * The `buffer` parameter is needed to decide wether or not to enable Bytecode
 * Caching so it doesn't **need** to be exact (we can leave out the env layer)
 */
export declare function getLambdaPreloadScripts(lambda: LambdaLike, buffer: {
    byteLength: number;
}, options: BytecodeCachingOptions): string[];
export {};
