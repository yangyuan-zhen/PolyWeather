import { builtinModules } from "node:module";
import { build } from "rolldown";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, relative } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { exports } from "resolve.exports";
import "@vercel/build-utils";
import "@vercel/nft";
import "oxc-transform";

//#region src/cervel/plugin.ts
const CJS_SHIM_PREFIX = "\0cjs-shim:";
const plugin = (args) => {
	const packageJsonCache = /* @__PURE__ */ new Map();
	const shimMeta = /* @__PURE__ */ new Map();
	const { tracedPaths } = args.context;
	const isBareImport = (id) => {
		return !id.startsWith(".") && !id.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(id);
	};
	/**
	* Read and cache package.json contents
	*/
	const getPackageJson = async (pkgPath) => {
		if (packageJsonCache.has(pkgPath)) return packageJsonCache.get(pkgPath);
		try {
			const contents = await readFile(pkgPath, "utf-8");
			const parsed = JSON.parse(contents);
			packageJsonCache.set(pkgPath, parsed);
			return parsed;
		} catch {
			packageJsonCache.set(pkgPath, null);
			return null;
		}
	};
	/**
	* Determine if a resolved module is CommonJS based on package.json exports
	*/
	const isCommonJS = async (bareImport, resolvedPath, resolvedInfo) => {
		const ext = extname(resolvedPath);
		if (ext === ".cjs") return true;
		if (ext === ".mjs") return false;
		if (ext === ".js" || ext === ".ts") {
			const pkgJsonPath = resolvedInfo.packageJsonPath;
			if (!pkgJsonPath) return true;
			const pkgJson = await getPackageJson(pkgJsonPath);
			if (!pkgJson) return true;
			const pkgDir = dirname(pkgJsonPath);
			const relativePath = resolvedPath.startsWith(pkgDir) ? resolvedPath.slice(pkgDir.length + 1).replace(/\\/g, "/") : null;
			if (!relativePath) return pkgJson.type !== "module";
			const pkgName = pkgJson.name || "";
			const subpath = bareImport.startsWith(pkgName) ? `.${bareImport.slice(pkgName.length)}` || "." : ".";
			try {
				if (exports(pkgJson, subpath, {
					require: false,
					conditions: ["node", "import"]
				})?.some((p) => p === relativePath || p === `./${relativePath}`)) return false;
				if (exports(pkgJson, subpath, {
					require: true,
					conditions: ["node", "require"]
				})?.some((p) => p === relativePath || p === `./${relativePath}`)) return true;
			} catch (err) {
				console.warn("Export resolution failed::", err);
			}
			if (pkgJson.module) return false;
			return pkgJson.type !== "module";
		}
		return true;
	};
	const isLocalImport = (id) => {
		if (id.startsWith("node:")) return false;
		if (id.includes("node_modules")) return false;
		return true;
	};
	return {
		name: "cervel",
		resolveId: {
			order: "pre",
			async handler(id, importer, rOpts) {
				if (id.startsWith(CJS_SHIM_PREFIX)) return {
					id,
					external: false
				};
				const resolved = await this.resolve(id, importer, rOpts);
				if (builtinModules.includes(id)) return {
					id: `node:${id}`,
					external: true
				};
				if (resolved?.id && isLocalImport(resolved.id)) tracedPaths.add(resolved.id);
				if (importer?.startsWith(CJS_SHIM_PREFIX) && isBareImport(id)) return {
					id,
					external: true
				};
				if (importer && isBareImport(id) && resolved?.id?.includes("node_modules")) {
					if (args.shimBareImports) {
						if (await isCommonJS(id, resolved.id, resolved)) {
							const importerPkgJsonPath = (await this.resolve(importer))?.packageJsonPath;
							if (importerPkgJsonPath) {
								const importerPkgDir = relative(args.repoRootPath, dirname(importerPkgJsonPath));
								const shimId$1 = `${CJS_SHIM_PREFIX}${importerPkgDir.replace(/\//g, "_")}_${id.replace(/\//g, "_")}`;
								shimMeta.set(shimId$1, {
									pkgDir: importerPkgDir,
									pkgName: id
								});
								return {
									id: shimId$1,
									external: false
								};
							}
							const shimId = `${CJS_SHIM_PREFIX}${id.replace(/\//g, "_")}`;
							shimMeta.set(shimId, {
								pkgDir: "",
								pkgName: id
							});
							return {
								id: shimId,
								external: false
							};
						}
					}
					return {
						external: true,
						id
					};
				}
				if (importer && isBareImport(id)) return resolved;
				return {
					external: true,
					...resolved,
					id: resolved?.id || id
				};
			}
		},
		load: { async handler(id) {
			if (id.startsWith(CJS_SHIM_PREFIX)) {
				const meta = shimMeta.get(id);
				if (!meta) return { code: `module.exports = require('${id.slice(10)}');` };
				const { pkgDir, pkgName } = meta;
				if (pkgDir) return { code: `
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const requireFromContext = createRequire(join(dirname(fileURLToPath(import.meta.url)), '${join("..", pkgDir, "package.json")}'));
module.exports = requireFromContext('${pkgName}');
`.trim() };
				return { code: `module.exports = require('${pkgName}');` };
			}
			return null;
		} }
	};
};

//#endregion
//#region src/cervel/rolldown.ts
const __dirname__filenameShim = `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
var require = typeof require !== 'undefined' ? require : __createRequire(import.meta.url);
var __filename = typeof __filename !== 'undefined' ? __filename : __fileURLToPath(import.meta.url);
var __dirname = typeof __dirname !== 'undefined' ? __dirname : __dirname_(__filename);
`.trim();

//#endregion
//#region src/introspection/loaders/rolldown-hooks.ts
function findProjectRoot(startDir) {
	let dir = startDir;
	while (dir !== "/" && dir !== ".") {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	return startDir;
}
let honoUrl = null;
let expressUrl = null;
const chunkCache = /* @__PURE__ */ new Map();
const bundled = /* @__PURE__ */ new Set();
async function resolve(specifier, context, nextResolve) {
	if (context.parentURL && specifier.startsWith("./")) {
		const resolvedUrl = pathToFileURL(join(dirname(fileURLToPath(context.parentURL)), specifier)).href;
		if (chunkCache.has(resolvedUrl)) return {
			url: resolvedUrl,
			shortCircuit: true
		};
	}
	const result = await nextResolve(specifier, context);
	if (specifier === "hono") honoUrl = result.url;
	else if (specifier === "express") expressUrl = result.url;
	return result;
}
async function load(url, context, nextLoad) {
	if (honoUrl === url) {
		const pathToHonoExtract = new URL("../hono.mjs", import.meta.url);
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
		const pathToExpressExtract = new URL("../express.mjs", import.meta.url);
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
	const cached = chunkCache.get(url);
	if (cached) return {
		format: "module",
		source: cached,
		shortCircuit: true
	};
	if (url.startsWith("file://") && !bundled.has(url) && !url.includes("/node_modules/")) {
		bundled.add(url);
		const filePath = fileURLToPath(url);
		const fileDir = dirname(filePath);
		const projectRoot = findProjectRoot(fileDir);
		const result = await build({
			input: filePath,
			write: false,
			platform: "node",
			cwd: projectRoot,
			plugins: [plugin({
				repoRootPath: projectRoot,
				outDir: fileDir,
				workPath: projectRoot,
				shimBareImports: true,
				context: { tracedPaths: /* @__PURE__ */ new Set() }
			})],
			output: {
				format: "esm",
				banner: __dirname__filenameShim
			}
		});
		for (const chunk of result.output) if (chunk.type === "chunk") {
			const chunkUrl = pathToFileURL(join(fileDir, chunk.fileName)).href;
			chunkCache.set(chunkUrl, chunk.code);
		}
		const entryChunk = result.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
		if (entryChunk && entryChunk.type === "chunk") return {
			format: "module",
			source: entryChunk.code,
			shortCircuit: true
		};
		return {
			format: "module",
			source: result.output[0].code,
			shortCircuit: true
		};
	}
	return nextLoad(url, context);
}

//#endregion
export { load, resolve };