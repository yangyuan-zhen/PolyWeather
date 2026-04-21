//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let module$1 = require("module");
module$1 = __toESM(module$1);
let path_to_regexp = require("path-to-regexp");
let __vercel_build_utils = require("@vercel/build-utils");

//#region src/rolldown/util.ts
const BEGIN_INTROSPECTION_RESULT = "\n__VERCEL_INTROSPECTION_BEGIN__\n";
const END_INTROSPECTION_RESULT = "\n__VERCEL_INTROSPECTION_END__\n";
const setupCloseHandlers = (cb) => {
	const callCallback = () => {
		const result = cb();
		if (result) console.log(`${BEGIN_INTROSPECTION_RESULT}${JSON.stringify(result)}${END_INTROSPECTION_RESULT}`);
	};
	process.on("SIGINT", callCallback);
	process.on("SIGTERM", callCallback);
	process.on("exit", callCallback);
};

//#endregion
//#region src/introspection/hono.ts
const apps = [];
const handle = (honoModule) => {
	const TrackedHono = class extends honoModule.Hono {
		constructor(...args) {
			super(...args);
			apps.push(this);
		}
	};
	return TrackedHono;
};
setupCloseHandlers(() => {
	const routes = extractRoutes$1();
	if (routes.length > 0) return { routes };
});
function extractRoutes$1() {
	const app$1 = apps.sort((a, b) => b.routes.length - a.routes.length)[0];
	if (!app$1 || !app$1.routes) return [];
	const routes = [];
	for (const route of app$1.routes) {
		const routePath = route.path;
		const method = route.method.toUpperCase();
		try {
			const { regexp } = (0, path_to_regexp.pathToRegexp)(routePath);
			if (routePath === "/") continue;
			routes.push({
				src: regexp.source,
				dest: routePath,
				methods: [method]
			});
		} catch (e) {
			(0, __vercel_build_utils.debug)(`Error extracting routes for ${routePath}: ${e instanceof Error ? e.message : "Unknown error"}`);
		}
	}
	return routes;
}

//#endregion
//#region src/introspection/express.ts
let app = null;
const handle$1 = (expressModule) => {
	if (typeof expressModule === "function") {
		const originalCreateApp = expressModule;
		const createApp = (...args) => {
			app = originalCreateApp(...args);
			return app;
		};
		Object.setPrototypeOf(createApp, originalCreateApp);
		Object.assign(createApp, originalCreateApp);
		return createApp;
	}
	return expressModule;
};
setupCloseHandlers(() => {
	const { routes, additionalFolders, additionalDeps } = extractRoutes();
	if (routes.length > 0) return {
		routes,
		additionalFolders,
		additionalDeps
	};
});
const extractRoutes = () => {
	if (!app) return {
		routes: [],
		additionalFolders: [],
		additionalDeps: []
	};
	const additionalFolders = [];
	const additionalDeps = [];
	const routes = [];
	const methods = [
		"all",
		"get",
		"post",
		"put",
		"delete",
		"patch",
		"options",
		"head"
	];
	const router = app._router || app.router;
	if ("settings" in app) {
		if ("views" in app.settings && typeof app.settings.views === "string") additionalFolders.push(app.settings.views);
		if ("view engine" in app.settings && typeof app.settings["view engine"] === "string") additionalDeps.push(app.settings["view engine"]);
	}
	for (const route of router.stack) if (route.route) {
		const m = [];
		for (const method of methods) if (route.route.methods[method]) m.push(method.toUpperCase());
		try {
			const { regexp } = (0, path_to_regexp.pathToRegexp)(route.route.path);
			if (route.route.path === "/") continue;
			routes.push({
				src: regexp.source,
				dest: route.route.path,
				methods: m
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error";
			(0, __vercel_build_utils.debug)(`Error extracting routes for ${route.route.path}: ${message}`);
		}
	}
	return {
		routes,
		additionalFolders,
		additionalDeps
	};
};

//#endregion
//#region src/introspection/loaders/cjs.ts
const originalRequire = module$1.default.prototype.require;
module$1.default.prototype.require = function(id, ...args) {
	const result = originalRequire.apply(this, [id, ...args]);
	if (id === "express") return handle$1(result);
	if (id === "hono") return {
		...result,
		Hono: handle(result)
	};
	return result;
};

//#endregion