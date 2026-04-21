/** @module Interface wasi:cli/terminal-stderr@0.2.6 **/
export function getTerminalStderr(): TerminalOutput | undefined;
export type TerminalOutput = import('./wasi-cli-terminal-output.js').TerminalOutput;
