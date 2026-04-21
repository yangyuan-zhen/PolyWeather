import { BuildOptions, Files, Span } from "@vercel/build-utils";

//#region src/rolldown/index.d.ts
declare const rolldown: (args: Pick<BuildOptions, 'entrypoint' | 'workPath' | 'repoRootPath' | 'config'> & {
  span?: Span;
}) => Promise<{
  files: Files;
  handler: string;
  framework: {
    slug: string;
    version: string;
  };
  localBuildFiles: Set<string>;
}>;
//#endregion
export { rolldown };