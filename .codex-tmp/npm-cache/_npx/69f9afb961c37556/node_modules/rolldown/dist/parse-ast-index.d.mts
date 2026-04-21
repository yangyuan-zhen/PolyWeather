import { M as ParseResult, N as ParserOptions } from "./shared/binding-B92Lq__Q.mjs";
import { Program } from "@oxc-project/types";

//#region src/parse-ast-index.d.ts
declare function parseAst(sourceText: string, options?: ParserOptions | null, filename?: string): Program;
declare function parseAstAsync(sourceText: string, options?: ParserOptions | null, filename?: string): Promise<Program>;
//#endregion
export { type ParseResult, type ParserOptions, parseAst, parseAstAsync };