import { C as BindingViteWasmHelperPluginConfig, b as BindingViteReporterPluginConfig, g as BindingViteJsonPluginConfig, h as BindingViteImportGlobPluginConfig, i as BindingEsmExternalRequirePluginConfig, m as BindingViteDynamicImportVarsPluginConfig, o as BindingIsolatedDeclarationPluginConfig, p as BindingViteBuildImportAnalysisPluginConfig, v as BindingViteModulePreloadPolyfillPluginConfig, x as BindingViteResolvePluginConfig, y as BindingViteReactRefreshWrapperPluginConfig } from "./binding-B92Lq__Q.mjs";
import { It as StringOrRegExp, M as BuiltinPlugin } from "./define-config-DO4TBkJV.mjs";

//#region src/builtin-plugin/constructors.d.ts
declare function viteModulePreloadPolyfillPlugin(config?: BindingViteModulePreloadPolyfillPluginConfig): BuiltinPlugin;
type DynamicImportVarsPluginConfig = Omit<BindingViteDynamicImportVarsPluginConfig, "include" | "exclude"> & {
  include?: StringOrRegExp | StringOrRegExp[];
  exclude?: StringOrRegExp | StringOrRegExp[];
};
declare function viteDynamicImportVarsPlugin(config?: DynamicImportVarsPluginConfig): BuiltinPlugin;
declare function viteImportGlobPlugin(config?: BindingViteImportGlobPluginConfig): BuiltinPlugin;
declare function viteReporterPlugin(config: BindingViteReporterPluginConfig): BuiltinPlugin;
declare function viteWasmHelperPlugin(config: BindingViteWasmHelperPluginConfig): BuiltinPlugin;
declare function viteWasmFallbackPlugin(): BuiltinPlugin;
declare function viteLoadFallbackPlugin(): BuiltinPlugin;
declare function viteJsonPlugin(config: BindingViteJsonPluginConfig): BuiltinPlugin;
declare function viteBuildImportAnalysisPlugin(config: BindingViteBuildImportAnalysisPluginConfig): BuiltinPlugin;
declare function viteResolvePlugin(config: Omit<BindingViteResolvePluginConfig, "yarnPnp">): BuiltinPlugin;
declare function isolatedDeclarationPlugin(config?: BindingIsolatedDeclarationPluginConfig): BuiltinPlugin;
declare function viteWebWorkerPostPlugin(): BuiltinPlugin;
declare function esmExternalRequirePlugin(config?: BindingEsmExternalRequirePluginConfig): BuiltinPlugin;
type ViteReactRefreshWrapperPluginConfig = Omit<BindingViteReactRefreshWrapperPluginConfig, "include" | "exclude"> & {
  include?: StringOrRegExp | StringOrRegExp[];
  exclude?: StringOrRegExp | StringOrRegExp[];
};
declare function viteReactRefreshWrapperPlugin(config: ViteReactRefreshWrapperPluginConfig): BuiltinPlugin;
//#endregion
export { viteImportGlobPlugin as a, viteModulePreloadPolyfillPlugin as c, viteResolvePlugin as d, viteWasmFallbackPlugin as f, viteDynamicImportVarsPlugin as i, viteReactRefreshWrapperPlugin as l, viteWebWorkerPostPlugin as m, isolatedDeclarationPlugin as n, viteJsonPlugin as o, viteWasmHelperPlugin as p, viteBuildImportAnalysisPlugin as r, viteLoadFallbackPlugin as s, esmExternalRequirePlugin as t, viteReporterPlugin as u };