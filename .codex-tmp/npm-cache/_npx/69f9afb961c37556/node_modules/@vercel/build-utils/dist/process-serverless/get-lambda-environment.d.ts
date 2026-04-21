import { type BytecodeCachingOptions } from './get-lambda-preload-scripts';
interface LambdaLike {
    awsLambdaHandler?: string;
    launcherType?: string;
    runtime: string;
    shouldAddHelpers?: boolean;
    shouldAddSourcemapSupport?: boolean;
    useWebApi?: boolean;
    shouldDisableAutomaticFetchInstrumentation?: boolean;
}
/**
 * Extract system environment variables that need to be injected in the Lambda.
 * Buffer is required just to determine if Bytecode Caching should be enabled
 * but it doesn't need to be super precise.
 */
export declare function getLambdaEnvironment(lambda: LambdaLike, buffer: {
    byteLength: number;
}, options: BytecodeCachingOptions): Record<string, string>;
export {};
