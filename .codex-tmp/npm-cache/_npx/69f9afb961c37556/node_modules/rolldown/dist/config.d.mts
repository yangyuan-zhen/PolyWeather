import "./shared/binding-B92Lq__Q.mjs";
import { r as defineConfig, t as ConfigExport } from "./shared/define-config-DO4TBkJV.mjs";

//#region src/utils/load-config.d.ts
declare function loadConfig(configPath: string): Promise<ConfigExport>;
//#endregion
//#region src/config.d.ts
declare const VERSION: string;
//#endregion
export { VERSION, defineConfig, loadConfig };