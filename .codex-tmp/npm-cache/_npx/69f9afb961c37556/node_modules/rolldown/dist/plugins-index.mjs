import "./shared/binding-C-UNREnT.mjs";
import { a as makeBuiltinPluginCallable, n as BuiltinPlugin } from "./shared/normalize-string-or-regex-Dq50a7l9.mjs";
import { t as esmExternalRequirePlugin } from "./shared/constructors-aZ82R2dj.mjs";

//#region src/builtin-plugin/replace-plugin.ts
/**
* Replaces targeted strings in files while bundling.
*
* @example
* // Basic usage
* ```js
* replacePlugin({
*   'process.env.NODE_ENV': JSON.stringify('production'),
*    __buildVersion: 15
* })
* ```
* @example
* // With options
* ```js
* replacePlugin({
*   'process.env.NODE_ENV': JSON.stringify('production'),
*   __buildVersion: 15
* }, {
*   preventAssignment: false,
* })
* ```
*/
function replacePlugin(values = {}, options = {}) {
	Object.keys(values).forEach((key) => {
		const value = values[key];
		if (typeof value !== "string") values[key] = String(value);
	});
	return makeBuiltinPluginCallable(new BuiltinPlugin("builtin:replace", {
		...options,
		values
	}));
}

//#endregion
export { esmExternalRequirePlugin, replacePlugin };