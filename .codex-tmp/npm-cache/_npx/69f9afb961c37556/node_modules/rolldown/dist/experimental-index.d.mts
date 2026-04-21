import { A as MinifyResult, B as isolatedDeclaration, D as IsolatedDeclarationsResult, E as IsolatedDeclarationsOptions, F as ResolveResult, G as transform, H as minify, I as ResolverFactory, K as transformSync, L as TransformOptions, M as ParseResult, N as ParserOptions, R as TransformResult, S as BindingViteTransformPluginConfig, U as minifySync, V as isolatedDeclarationSync, W as moduleRunnerTransform, _ as BindingViteManifestPluginConfig, j as NapiResolveOptions, k as MinifyOptions, l as BindingRebuildStrategy, n as BindingBundleState, r as BindingClientHmrUpdate, z as createTokioRuntime } from "./shared/binding-B92Lq__Q.mjs";
import { M as BuiltinPlugin, Mt as OutputOptions, Ut as freeExternalMemory, Vt as RolldownOutput, c as InputOptions, it as NormalizedOutputOptions, q as defineParallelPlugin } from "./shared/define-config-DO4TBkJV.mjs";
import { a as viteImportGlobPlugin, c as viteModulePreloadPolyfillPlugin, d as viteResolvePlugin, f as viteWasmFallbackPlugin, i as viteDynamicImportVarsPlugin, l as viteReactRefreshWrapperPlugin, m as viteWebWorkerPostPlugin, n as isolatedDeclarationPlugin, o as viteJsonPlugin, p as viteWasmHelperPlugin, r as viteBuildImportAnalysisPlugin, s as viteLoadFallbackPlugin, u as viteReporterPlugin } from "./shared/constructors-D_KFsTQ-.mjs";

//#region src/api/dev/dev-options.d.ts
type DevOnHmrUpdates = (result: Error | {
  updates: BindingClientHmrUpdate[];
  changedFiles: string[];
}) => void | Promise<void>;
type DevOnOutput = (result: Error | RolldownOutput) => void | Promise<void>;
interface DevWatchOptions {
  /**
  	* If `true`, files are not written to disk.
  	* @default false
  	*/
  skipWrite?: boolean;
  /**
  	* If `true`, use polling instead of native file system events for watching.
  	* @default false
  	*/
  usePolling?: boolean;
  /**
  	* Poll interval in milliseconds (only used when usePolling is true).
  	* @default 100
  	*/
  pollInterval?: number;
  /**
  	* If `true`, use debounced watcher. If `false`, use non-debounced watcher for immediate responses.
  	* @default true
  	*/
  useDebounce?: boolean;
  /**
  	* Debounce duration in milliseconds (only used when useDebounce is true).
  	* @default 10
  	*/
  debounceDuration?: number;
  /**
  	* Whether to compare file contents for poll-based watchers (only used when usePolling is true).
  	* When enabled, poll watchers will check file contents to determine if they actually changed.
  	* @default false
  	*/
  compareContentsForPolling?: boolean;
  /**
  	* Tick rate in milliseconds for debounced watchers (only used when useDebounce is true).
  	* Controls how frequently the debouncer checks for events to process.
  	* When not specified, the debouncer will auto-select an appropriate tick rate (1/4 of the debounce duration).
  	* @default undefined (auto-select)
  	*/
  debounceTickRate?: number;
}
interface DevOptions {
  onHmrUpdates?: DevOnHmrUpdates;
  onOutput?: DevOnOutput;
  /**
  	* Strategy for triggering rebuilds after HMR updates.
  	* - `'always'`: Always trigger a rebuild after HMR updates
  	* - `'auto'`: Trigger rebuild only if HMR updates contain full reload updates
  	* - `'never'`: Never trigger rebuild after HMR updates (default)
  	* @default 'auto'
  	*/
  rebuildStrategy?: "always" | "auto" | "never";
  watch?: DevWatchOptions;
}
//#endregion
//#region src/api/dev/dev-engine.d.ts
declare class DevEngine {
  #private;
  static create(inputOptions: InputOptions, outputOptions?: OutputOptions, devOptions?: DevOptions): Promise<DevEngine>;
  private constructor();
  run(): Promise<void>;
  ensureCurrentBuildFinish(): Promise<void>;
  getBundleState(): Promise<BindingBundleState>;
  ensureLatestBuildOutput(): Promise<void>;
  invalidate(file: string, firstInvalidatedBy?: string): Promise<BindingClientHmrUpdate[]>;
  registerModules(clientId: string, modules: string[]): Promise<void>;
  removeClient(clientId: string): Promise<void>;
  close(): Promise<void>;
  /**
  	* Compile a lazy entry module and return HMR-style patch code.
  	*
  	* This is called when a dynamically imported module is first requested at runtime.
  	* The module was previously stubbed with a proxy, and now we need to compile the
  	* actual module and its dependencies.
  	*
  	* @param moduleId - The absolute file path of the module to compile
  	* @param clientId - The client ID requesting this compilation
  	* @returns The compiled JavaScript code as a string (HMR patch format)
  	*/
  compileEntry(moduleId: string, clientId: string): Promise<string>;
}
//#endregion
//#region src/api/dev/index.d.ts
declare const dev: typeof DevEngine.create;
//#endregion
//#region src/api/experimental.d.ts
/**
* This is an experimental API. Its behavior may change in the future.
*
* - Calling this API will only execute the `scan/build` stage of rolldown.
* - `scan` will clean up all resources automatically, but if you want to ensure timely cleanup, you need to wait for the returned promise to resolve.
*
* @example To ensure cleanup of resources, use the returned promise to wait for the scan to complete.
* ```ts
* import { scan } from 'rolldown/api/experimental';
*
* const cleanupPromise = await scan(...);
* await cleanupPromise;
* // Now all resources have been cleaned up.
* ```
*/
declare const scan: (rawInputOptions: InputOptions, rawOutputOptions?: {}) => Promise<Promise<void>>;
//#endregion
//#region src/utils/parse.d.ts
/**
* Parse asynchronously.
*
* Note: This function can be slower than `parseSync` due to the overhead of spawning a thread.
*/
declare function parse(filename: string, sourceText: string, options?: ParserOptions | null): Promise<ParseResult>;
/** Parse synchronously. */
declare function parseSync(filename: string, sourceText: string, options?: ParserOptions | null): ParseResult;
//#endregion
//#region src/builtin-plugin/alias-plugin.d.ts
type ViteAliasPluginConfig = {
  entries: {
    find: string | RegExp;
    replacement: string;
  }[];
};
declare function viteAliasPlugin(config: ViteAliasPluginConfig): BuiltinPlugin;
//#endregion
//#region src/builtin-plugin/transform-plugin.d.ts
type TransformPattern = string | RegExp | readonly (RegExp | string)[];
type TransformPluginConfig = Omit<BindingViteTransformPluginConfig, "include" | "exclude" | "jsxRefreshInclude" | "jsxRefreshExclude" | "yarnPnp"> & {
  include?: TransformPattern;
  exclude?: TransformPattern;
  jsxRefreshInclude?: TransformPattern;
  jsxRefreshExclude?: TransformPattern;
};
declare function viteTransformPlugin(config: TransformPluginConfig): BuiltinPlugin;
//#endregion
//#region src/builtin-plugin/vite-manifest-plugin.d.ts
type ViteManifestPluginConfig = Omit<BindingViteManifestPluginConfig, "isLegacy"> & {
  isOutputOptionsForLegacyChunks?: (outputOptions: NormalizedOutputOptions) => boolean;
};
declare function viteManifestPlugin(config: ViteManifestPluginConfig): BuiltinPlugin;
//#endregion
//#region src/experimental-index.d.ts
/**
* In-memory file system for browser builds.
*
* This is a re-export of the {@link https://github.com/streamich/memfs | memfs} package used by the WASI runtime.
* It allows you to read and write files to a virtual filesystem when using rolldown in browser environments.
*
* - `fs`: A Node.js-compatible filesystem API (`IFs` from memfs)
* - `volume`: The underlying `Volume` instance that stores the filesystem state
*
* Returns `undefined` in Node.js builds (only available in browser builds via `@rolldown/browser`).
*
* @example
* ```typescript
* import { memfs } from 'rolldown/experimental';
*
* // Write files to virtual filesystem before bundling
* memfs?.volume.fromJSON({
*   '/src/index.js': 'export const foo = 42;',
*   '/package.json': '{"name": "my-app"}'
* });
*
* // Read files from the virtual filesystem
* const content = memfs?.fs.readFileSync('/src/index.js', 'utf8');
* ```
*
* @see {@link https://github.com/streamich/memfs} for more information on the memfs API.
*/
declare const memfs: {
  fs: any;
  volume: any;
} | undefined;
//#endregion
export { type BindingClientHmrUpdate, BindingRebuildStrategy, DevEngine, type DevOptions, type DevWatchOptions, type IsolatedDeclarationsOptions, type IsolatedDeclarationsResult, type MinifyOptions, type MinifyResult, type ParseResult, type ParserOptions, type NapiResolveOptions as ResolveOptions, type ResolveResult, ResolverFactory, type TransformOptions, type TransformResult, createTokioRuntime, defineParallelPlugin, dev, viteDynamicImportVarsPlugin as dynamicImportVarsPlugin, viteDynamicImportVarsPlugin, freeExternalMemory, viteImportGlobPlugin as importGlobPlugin, viteImportGlobPlugin, isolatedDeclaration, isolatedDeclarationPlugin, isolatedDeclarationSync, memfs, minify, minifySync, moduleRunnerTransform, parse, parseSync, scan, transform, transformSync, viteAliasPlugin, viteBuildImportAnalysisPlugin, viteJsonPlugin, viteLoadFallbackPlugin, viteManifestPlugin, viteModulePreloadPolyfillPlugin, viteReactRefreshWrapperPlugin, viteReporterPlugin, viteResolvePlugin, viteTransformPlugin, viteWasmFallbackPlugin, viteWasmHelperPlugin, viteWebWorkerPostPlugin };