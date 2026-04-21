import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";

//#region src/rolldown/hooks.ts
const getRequiredEnv = (key) => {
	const value = process.env[key];
	if (!value) throw new Error(`${key} is not set`);
	return value;
};
const repoRootPath = getRequiredEnv("VERCEL_INTROSPECTION_REPO_ROOT_PATH");
const handlerPath = getRequiredEnv("VERCEL_INTROSPECTION_HANDLER");
const handlerBuilt = getRequiredEnv("VERCEL_INTROSPECTION_HANDLER_BUILT");
const tmpDir = realpathSync(getRequiredEnv("VERCEL_INTROSPECTION_TMP_DIR"));
let honoUrl = null;
let expressUrl = null;
async function resolve(specifier, context, nextResolve) {
	let specifierAsPath = null;
	try {
		specifierAsPath = fileURLToPath(specifier);
	} catch {}
	if (specifierAsPath === handlerPath) return {
		url: pathToFileURL(join(tmpDir, handlerBuilt)).href,
		shortCircuit: true
	};
	if (specifier.startsWith(".") && context.parentURL) {
		const resolvedPath = join(dirname(fileURLToPath(context.parentURL)), specifier);
		if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) return {
			url: pathToFileURL(resolvedPath).href,
			shortCircuit: true
		};
	}
	if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:") && context.parentURL) {
		const parentPath = fileURLToPath(context.parentURL);
		if (parentPath.startsWith(tmpDir)) {
			const mappedParent = join(repoRootPath, relative(tmpDir, parentPath));
			const result = await nextResolve(specifier, {
				...context,
				parentURL: pathToFileURL(mappedParent).href
			});
			if (specifier === "hono") honoUrl = result.url;
			else if (specifier === "express") expressUrl = result.url;
			return result;
		}
	}
	return nextResolve(specifier, context);
}
async function load(url, context, nextLoad) {
	if (honoUrl === url) {
		const pathToHonoExtract = new URL("../introspection/hono.mjs", import.meta.url);
		return {
			format: "module",
			source: `
import { handle } from ${JSON.stringify(pathToHonoExtract.toString())};
import * as originalHono from ${JSON.stringify(url + "?original")};

export * from ${JSON.stringify(url + "?original")};
export const Hono = handle(originalHono);
`,
			shortCircuit: true
		};
	}
	if (expressUrl === url) {
		const pathToExpressExtract = new URL("../introspection/express.mjs", import.meta.url);
		return {
			format: "module",
			source: `
import { handle } from ${JSON.stringify(pathToExpressExtract.toString())};
import originalExpress from ${JSON.stringify(url + "?original")};

const extendedExpress = handle(originalExpress);

export * from ${JSON.stringify(url + "?original")};
export default extendedExpress;
`,
			shortCircuit: true
		};
	}
	if (url.endsWith("?original")) return nextLoad(url, context);
	return nextLoad(url, context);
}

//#endregion
export { load, resolve };