import { n as __toESM, t as require_binding } from "./shared/binding-C-UNREnT.mjs";
import { n as onExit, t as watch } from "./shared/watch-B2WRkpw2.mjs";
import "./shared/normalize-string-or-regex-Dq50a7l9.mjs";
import { S as VERSION } from "./shared/bindingify-input-options-Cb-01HR1.mjs";
import "./shared/rolldown-build-KB1YaNe-.mjs";
import "./shared/parse-ast-index-B6LAhWD8.mjs";
import { t as rolldown } from "./shared/rolldown-CIC_OHw3.mjs";
import { t as defineConfig } from "./shared/define-config-BVG4QvnP.mjs";
import { isMainThread } from "node:worker_threads";

//#region src/setup.ts
var import_binding = /* @__PURE__ */ __toESM(require_binding(), 1);
if (isMainThread) {
	const subscriberGuard = (0, import_binding.initTraceSubscriber)();
	onExit(() => {
		subscriberGuard?.close();
	});
}

//#endregion
//#region src/api/build.ts
/**
* The API similar to esbuild's `build` function.
*
* @example
* ```js
* import { build } from 'rolldown';
*
* const result = await build({
*   input: 'src/main.js',
*   output: {
*     file: 'bundle.js',
*   },
* });
* console.log(result);
* ```
*
* @experimental
* @category Programmatic APIs
*/
async function build(options) {
	if (Array.isArray(options)) return Promise.all(options.map((opts) => build(opts)));
	else {
		const { output, write = true, ...inputOptions } = options;
		const build = await rolldown(inputOptions);
		try {
			if (write) return await build.write(output);
			else return await build.generate(output);
		} finally {
			await build.close();
		}
	}
}

//#endregion
var BindingMagicString = import_binding.BindingMagicString;
export { BindingMagicString, VERSION, build, defineConfig, rolldown, watch };