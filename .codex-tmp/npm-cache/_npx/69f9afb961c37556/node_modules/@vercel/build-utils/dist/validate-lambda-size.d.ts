/// <reference types="node" />
import { NowBuildError } from './errors';
/**
 * Max compressed ZIP size (300 MB).
 * Limit is 250 MB uncompressed; we set 300 MB compressed as a safety
 * buffer. Python is exempt because AI workloads commonly exceed this.
 */
export declare const MAX_LAMBDA_SIZE: number;
/**
 * Max uncompressed size (250 MB).
 */
export declare const MAX_LAMBDA_UNCOMPRESSED_SIZE: number;
/**
 * Error thrown when a Lambda's compressed ZIP exceeds the allowed size.
 */
export declare class FunctionSizeError extends NowBuildError {
    size: number;
    maxSize: number;
    constructor(outputPath: string, size: number);
}
/**
 * Validates the compressed size of a Lambda function.
 * Python runtimes are exempt because AI workloads commonly exceed 300 MB.
 */
export declare function validateLambdaSize(outputPath: string, runtime: string, size: number): void;
/**
 * Validates the uncompressed size of a Lambda function.
 */
export declare function validateUncompressedLambdaSize(outputPath: string, uncompressedBytes: number): void;
/**
 * Runtimes that support env wrapper.
 */
export declare const ENV_WRAPPER_SUPPORTED_FAMILIES: string[];
interface LambdaLikeForEnvWrapper {
    createZip?: () => Promise<Buffer>;
    runtime: string;
    supportsWrapper?: boolean;
}
/**
 * When the function requires a file for the encrypted environment variables,
 * it needs to support wrappers. Also, the function must have a `createZip`
 * function since we need to "re-compress" to include the file in the final
 * lambda.
 */
export declare function validateEnvWrapperSupport(encryptedEnvFilename: string | undefined, encryptedEnvContent: string | undefined, lambda: LambdaLikeForEnvWrapper): void;
export {};
