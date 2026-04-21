type ModuleType = typeof import('#wasm/vercel_python_analysis.js');
type RootType = Awaited<ReturnType<ModuleType['instantiate']>>;
export declare function importWasmModule(): Promise<RootType>;
export {};
