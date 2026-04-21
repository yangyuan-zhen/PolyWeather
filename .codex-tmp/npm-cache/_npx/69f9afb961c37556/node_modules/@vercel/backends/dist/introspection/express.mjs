import { pathToRegexp } from "path-to-regexp";
import { debug } from "@vercel/build-utils";

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
//#region src/introspection/express.ts
let app = null;
const handle = (expressModule) => {
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
			const { regexp } = pathToRegexp(route.route.path);
			if (route.route.path === "/") continue;
			routes.push({
				src: regexp.source,
				dest: route.route.path,
				methods: m
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error";
			debug(`Error extracting routes for ${route.route.path}: ${message}`);
		}
	}
	return {
		routes,
		additionalFolders,
		additionalDeps
	};
};

//#endregion
export { handle };