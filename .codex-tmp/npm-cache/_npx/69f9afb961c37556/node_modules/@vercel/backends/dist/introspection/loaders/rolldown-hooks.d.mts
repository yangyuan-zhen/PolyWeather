/// <reference types="node" resolution-mode="require"/>
//#region src/introspection/loaders/rolldown-hooks.d.ts
declare function resolve(specifier: string, context: {
  parentURL?: string;
}, nextResolve: (specifier: string, context: {
  parentURL?: string;
}) => Promise<{
  url: string;
}>): Promise<{
  url: string;
} | {
  url: string;
  shortCircuit: boolean;
}>;
declare function load(url: string, context: {
  format?: string;
}, nextLoad: (url: string, context: {
  format?: string;
}) => Promise<{
  format: string;
  source: string | Buffer;
}>): Promise<{
  format: string;
  source: string | Buffer;
} | {
  format: string;
  source: string;
  shortCircuit: boolean;
}>;
//#endregion
export { load, resolve };