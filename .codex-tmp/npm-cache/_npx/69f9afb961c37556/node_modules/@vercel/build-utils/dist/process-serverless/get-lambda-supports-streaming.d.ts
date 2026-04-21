interface LambdaLike {
    handler: string;
    launcherType?: string;
    runtime: string;
    supportsResponseStreaming?: boolean;
}
export interface SupportsStreamingResult {
    supportsStreaming: boolean | undefined;
    error?: {
        handler: string;
        message: string;
    };
}
/**
 * Determines if a Lambda should have streaming enabled. If
 * `forceStreamingRuntime` is true, streaming is always enabled. If the
 * setting is defined it will be honored. Enabled by default for Node.js.
 */
export declare function getLambdaSupportsStreaming(lambda: LambdaLike, forceStreamingRuntime: boolean): Promise<SupportsStreamingResult>;
export {};
