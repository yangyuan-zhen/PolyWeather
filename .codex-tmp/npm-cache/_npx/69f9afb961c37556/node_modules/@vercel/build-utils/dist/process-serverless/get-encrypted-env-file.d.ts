import FileBlob from '../file-blob';
/**
 * A type to represent the encrypted environment file that needs to be
 * attached to Lambdas with ENV > 4kb
 */
export type EncryptedEnvFile = [string, FileBlob];
/**
 * Get the encrypted environment file from the environment variables if it
 * exists and it is supported by the runtime.
 */
export declare function getEncryptedEnv(envFilename: string | undefined, envContent: string | undefined): EncryptedEnvFile | undefined;
