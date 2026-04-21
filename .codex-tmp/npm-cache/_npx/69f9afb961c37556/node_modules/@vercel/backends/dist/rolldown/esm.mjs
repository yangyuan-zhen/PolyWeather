import { register } from "node:module";

//#region src/rolldown/esm.ts
register(new URL("./hooks.mjs", import.meta.url), import.meta.url);

//#endregion
export {  };