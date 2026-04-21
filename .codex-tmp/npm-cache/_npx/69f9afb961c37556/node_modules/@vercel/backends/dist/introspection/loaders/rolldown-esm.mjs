import { register } from "node:module";

//#region src/introspection/loaders/rolldown-esm.ts
register(new URL("./rolldown-hooks.mjs", import.meta.url), import.meta.url);

//#endregion
export {  };