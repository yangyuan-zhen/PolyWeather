import { n as __toESM, t as require_binding } from "./shared/binding-C-UNREnT.mjs";
import "./shared/normalize-string-or-regex-Dq50a7l9.mjs";
import { n as PluginContextData, r as bindingifyPlugin } from "./shared/bindingify-input-options-Cb-01HR1.mjs";
import "./shared/parse-ast-index-B6LAhWD8.mjs";
import { parentPort, workerData } from "node:worker_threads";

//#region src/parallel-plugin-worker.ts
var import_binding = /* @__PURE__ */ __toESM(require_binding(), 1);
const { registryId, pluginInfos, threadNumber } = workerData;
(async () => {
	try {
		(0, import_binding.registerPlugins)(registryId, await Promise.all(pluginInfos.map(async (pluginInfo) => {
			const definePluginImpl = (await import(pluginInfo.fileUrl)).default;
			const plugin = await definePluginImpl(pluginInfo.options, { threadNumber });
			return {
				index: pluginInfo.index,
				plugin: bindingifyPlugin(plugin, {}, {}, new PluginContextData(() => {}, {}, []), [], () => {}, "info", false)
			};
		})));
		parentPort.postMessage({ type: "success" });
	} catch (error) {
		parentPort.postMessage({
			type: "error",
			error
		});
	} finally {
		parentPort.unref();
	}
})();

//#endregion
export {  };