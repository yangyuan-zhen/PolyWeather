"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandFinished = exports.Command = void 0;
const resolveSignal_1 = require("./utils/resolveSignal");
/**
 * A command executed in a Sandbox.
 *
 * For detached commands, you can {@link wait} to get a {@link CommandFinished} instance
 * with the populated exit code. For non-detached commands, {@link Sandbox.runCommand}
 * automatically waits and returns a {@link CommandFinished} instance.
 *
 * You can iterate over command output with {@link logs}.
 *
 * @see {@link Sandbox.runCommand} to start a command.
 *
 * @hideconstructor
 */
class Command {
    /**
     * ID of the command execution.
     */
    get cmdId() {
        return this.cmd.id;
    }
    get cwd() {
        return this.cmd.cwd;
    }
    get startedAt() {
        return this.cmd.startedAt;
    }
    /**
     * @param params - Object containing the client, sandbox ID, and command ID.
     * @param params.client - API client used to interact with the backend.
     * @param params.sandboxId - The ID of the sandbox where the command is running.
     * @param params.cmdId - The ID of the command execution.
     */
    constructor({ client, sandboxId, cmd, }) {
        this.outputCache = null;
        this.client = client;
        this.sandboxId = sandboxId;
        this.cmd = cmd;
        this.exitCode = cmd.exitCode ?? null;
    }
    /**
     * Iterate over the output of this command.
     *
     * ```
     * for await (const log of cmd.logs()) {
     *   if (log.stream === "stdout") {
     *     process.stdout.write(log.data);
     *   } else {
     *     process.stderr.write(log.data);
     *   }
     * }
     * ```
     *
     * @param opts - Optional parameters.
     * @param opts.signal - An AbortSignal to cancel log streaming.
     * @returns An async iterable of log entries from the command output.
     *
     * @see {@link Command.stdout}, {@link Command.stderr}, and {@link Command.output}
     * to access output as a string.
     */
    logs(opts) {
        return this.client.getLogs({
            sandboxId: this.sandboxId,
            cmdId: this.cmd.id,
            signal: opts?.signal,
        });
    }
    /**
     * Wait for a command to exit and populate its exit code.
     *
     * This method is useful for detached commands where you need to wait
     * for completion. For non-detached commands, {@link Sandbox.runCommand}
     * automatically waits and returns a {@link CommandFinished} instance.
     *
     * ```
     * const detachedCmd = await sandbox.runCommand({ cmd: 'sleep', args: ['5'], detached: true });
     * const result = await detachedCmd.wait();
     * if (result.exitCode !== 0) {
     *   console.error("Something went wrong...")
     * }
     * ```
     *
     * @param params - Optional parameters.
     * @param params.signal - An AbortSignal to cancel waiting.
     * @returns A {@link CommandFinished} instance with populated exit code.
     */
    async wait(params) {
        params?.signal?.throwIfAborted();
        const command = await this.client.getCommand({
            sandboxId: this.sandboxId,
            cmdId: this.cmd.id,
            wait: true,
            signal: params?.signal,
        });
        return new CommandFinished({
            client: this.client,
            sandboxId: this.sandboxId,
            cmd: command.json.command,
            exitCode: command.json.command.exitCode,
        });
    }
    /**
     * Get cached output, fetching logs only once and reusing for concurrent calls.
     * This prevents race conditions when stdout() and stderr() are called in parallel.
     */
    async getCachedOutput(opts) {
        if (!this.outputCache) {
            this.outputCache = (async () => {
                try {
                    let stdout = "";
                    let stderr = "";
                    let both = "";
                    for await (const log of this.logs({ signal: opts?.signal })) {
                        both += log.data;
                        if (log.stream === "stdout") {
                            stdout += log.data;
                        }
                        else {
                            stderr += log.data;
                        }
                    }
                    return { stdout, stderr, both };
                }
                catch (err) {
                    // Clear the promise so future calls can retry
                    this.outputCache = null;
                    throw err;
                }
            })();
        }
        return this.outputCache;
    }
    /**
     * Get the output of `stdout`, `stderr`, or both as a string.
     *
     * NOTE: This may throw string conversion errors if the command does
     * not output valid Unicode.
     *
     * @param stream - The output stream to read: "stdout", "stderr", or "both".
     * @param opts - Optional parameters.
     * @param opts.signal - An AbortSignal to cancel output streaming.
     * @returns The output of the specified stream(s) as a string.
     */
    async output(stream = "both", opts) {
        const cached = await this.getCachedOutput(opts);
        return cached[stream];
    }
    /**
     * Get the output of `stdout` as a string.
     *
     * NOTE: This may throw string conversion errors if the command does
     * not output valid Unicode.
     *
     * @param opts - Optional parameters.
     * @param opts.signal - An AbortSignal to cancel output streaming.
     * @returns The standard output of the command.
     */
    async stdout(opts) {
        return this.output("stdout", opts);
    }
    /**
     * Get the output of `stderr` as a string.
     *
     * NOTE: This may throw string conversion errors if the command does
     * not output valid Unicode.
     *
     * @param opts - Optional parameters.
     * @param opts.signal - An AbortSignal to cancel output streaming.
     * @returns The standard error output of the command.
     */
    async stderr(opts) {
        return this.output("stderr", opts);
    }
    /**
     * Kill a running command in a sandbox.
     *
     * @param signal - The signal to send the running process. Defaults to SIGTERM.
     * @param opts - Optional parameters.
     * @param opts.abortSignal - An AbortSignal to cancel the kill operation.
     * @returns Promise<void>.
     */
    async kill(signal, opts) {
        await this.client.killCommand({
            sandboxId: this.sandboxId,
            commandId: this.cmd.id,
            signal: (0, resolveSignal_1.resolveSignal)(signal ?? "SIGTERM"),
            abortSignal: opts?.abortSignal,
        });
    }
}
exports.Command = Command;
/**
 * A command that has finished executing.
 *
 * The exit code is immediately available and populated upon creation.
 * Unlike {@link Command}, you don't need to call wait() - the command
 * has already completed execution.
 *
 * @hideconstructor
 */
class CommandFinished extends Command {
    /**
     * @param params - Object containing client, sandbox ID, command ID, and exit code.
     * @param params.client - API client used to interact with the backend.
     * @param params.sandboxId - The ID of the sandbox where the command ran.
     * @param params.cmdId - The ID of the command execution.
     * @param params.exitCode - The exit code of the completed command.
     */
    constructor(params) {
        super({ ...params });
        this.exitCode = params.exitCode;
    }
    /**
     * The wait method is not needed for CommandFinished instances since
     * the command has already completed and exitCode is populated.
     *
     * @deprecated This method is redundant for CommandFinished instances.
     * The exitCode is already available.
     * @returns This CommandFinished instance.
     */
    async wait() {
        return this;
    }
}
exports.CommandFinished = CommandFinished;
//# sourceMappingURL=command.js.map