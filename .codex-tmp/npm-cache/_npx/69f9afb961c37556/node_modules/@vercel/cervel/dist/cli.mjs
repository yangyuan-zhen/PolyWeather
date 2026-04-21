import { parseArgs } from "node:util";
import { cervelBuild as build, cervelServe as serve, srvxOptions } from "@vercel/backends";

//#region src/cli.ts
const main = async () => {
	const options = parseArgs$1(process.argv.slice(2));
	const { cwd, out,...rest } = options.values;
	const [command, entrypoint] = options.positionals;
	const workPath = cwd;
	const repoRootPath = cwd;
	if (command === "build") await build({
		workPath,
		repoRootPath,
		out,
		entrypoint
	});
	else await serve({
		workPath,
		rest
	});
};
function parseArgs$1(args) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			cwd: {
				type: "string",
				default: process.cwd()
			},
			out: {
				type: "string",
				default: "dist"
			},
			...srvxOptions
		}
	});
	return {
		values,
		positionals
	};
}

//#endregion
export { main };