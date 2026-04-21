/// <reference types="node" resolution-mode="require"/>
//#region src/rolldown/hooks.d.ts
interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
}
interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
  format?: string;
}
interface LoadContext {
  format?: string;
  importAttributes?: Record<string, string>;
}
interface LoadResult {
  format: string;
  source?: string | Buffer;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;
type NextLoad = (url: string, context: LoadContext) => Promise<LoadResult>;
declare function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): Promise<ResolveResult>;
declare function load(url: string, context: LoadContext, nextLoad: NextLoad): Promise<LoadResult>;
//#endregion
export { load, resolve };