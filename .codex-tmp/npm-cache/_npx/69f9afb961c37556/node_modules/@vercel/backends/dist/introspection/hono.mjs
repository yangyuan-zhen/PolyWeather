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
	const routes = extractRoutes();
	if (routes.length > 0) return { routes };
});
function extractRoutes() {
	const app = apps.sort((a, b) => b.routes.length - a.routes.length)[0];
	if (!app || !app.routes) return [];
	const routes = [];
	for (const route of app.routes) {
		const routePath = route.path;
		const method = route.method.toUpperCase();
		try {
			const { regexp } = pathToRegexp(routePath);
			if (routePath === "/") continue;
			routes.push({
				src: regexp.source,
				dest: routePath,
				methods: [method]
			});
		} catch (e) {
			debug(`Error extracting routes for ${routePath}: ${e instanceof Error ? e.message : "Unknown error"}`);
		}
	}
	return routes;
}

//#endregion
export { handle };