type BundledDefinitions = Record<string, unknown>;
interface Output {
    debug(message: string): void;
    time<T>(label: string, promise: Promise<T>): Promise<T>;
}
type PrepareFlagsDefinitionsResult = {
    created: false;
    reason: 'no-sdk-keys';
} | {
    created: true;
    sdkKeysCount: number;
};
/**
 * Computes a SHA-256 hex digest of the given SDK key.
 */
declare function hashSdkKey(sdkKey: string): string;
/**
 * Generates a JS module with deduplicated, lazily-parsed definitions.
 *
 * The map keys are SHA-256 hashes of the SDK keys so that raw keys
 * are not embedded in the output.
 *
 * Output format:
 * ```js
 * const memo = (fn) => { let cached; return () => (cached ??= fn()); };
 * const _d0 = memo(() => JSON.parse('...'));
 * const map = { "<sha256_hash>": _d0 };
 * export function get(hashedSdkKey) { return map[hashedSdkKey]?.() ?? null; }
 * ```
 */
declare function generateDefinitionsModule(sdkKeys: string[], values: BundledDefinitions[]): string;
/**
 * Prepares flag definitions by reading SDK keys from environment variables,
 * fetching definitions from flags.vercel.com, and writing them into a
 * synthetic `@vercel/flags-definitions` package inside `node_modules/`.
 */
declare function prepareFlagsDefinitions(options: {
    cwd: string;
    env: Record<string, string | undefined>;
    /**
     * Appended to the user-agent header to identify the caller.
     * Example: `"vercel-cli/35.0.0"`
     */
    userAgentSuffix?: string;
    fetch?: typeof globalThis.fetch;
    output?: Output;
}): Promise<PrepareFlagsDefinitionsResult>;

export { type Output, type PrepareFlagsDefinitionsResult, generateDefinitionsModule, hashSdkKey, prepareFlagsDefinitions };
