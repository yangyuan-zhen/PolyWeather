/** @module Interface wasi:cli/terminal-stdout@0.2.6 **/
export function getTerminalStdout(): TerminalOutput | undefined;
export type TerminalOutput = import('./wasi-cli-terminal-output.js').TerminalOutput;
