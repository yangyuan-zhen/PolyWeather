import { APIClient, type CommandData } from "./api-client";
import { Signal } from "./utils/resolveSignal";
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
export declare class Command {
    /**
     * @internal
     * @private
     */
    protected client: APIClient;
    /**
     * ID of the sandbox this command is running in.
     */
    private sandboxId;
    /**
     * Data for the command execution.
     */
    private cmd;
    exitCode: number | null;
    private outputCache;
    /**
     * ID of the command execution.
     */
    get cmdId(): string;
    get cwd(): string;
    get startedAt(): number;
    /**
     * @param params - Object containing the client, sandbox ID, and command ID.
     * @param params.client - API client used to interact with the backend.
     * @param params.sandboxId - The ID of the sandbox where the command is running.
     * @param params.cmdId - The ID of the command execution.
     */
    constructor({ client, sandboxId, cmd, }: {
        client: APIClient;
        sandboxId: string;
        cmd: CommandData;
    });
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
    logs(opts?: {
        signal?: AbortSignal;
    }): AsyncGenerator<{
        data: string;
        stream: "stdout";
    } | {
        data: string;
        stream: "stderr";
    }, void, void> & Disposable & {
        close(): void;
    };
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
    wait(params?: {
        signal?: AbortSignal;
    }): Promise<CommandFinished>;
    /**
     * Get cached output, fetching logs only once and reusing for concurrent calls.
     * This prevents race conditions when stdout() and stderr() are called in parallel.
     */
    private getCachedOutput;
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
    output(stream?: "stdout" | "stderr" | "both", opts?: {
        signal?: AbortSignal;
    }): Promise<string>;
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
    stdout(opts?: {
        signal?: AbortSignal;
    }): Promise<string>;
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
    stderr(opts?: {
        signal?: AbortSignal;
    }): Promise<string>;
    /**
     * Kill a running command in a sandbox.
     *
     * @param signal - The signal to send the running process. Defaults to SIGTERM.
     * @param opts - Optional parameters.
     * @param opts.abortSignal - An AbortSignal to cancel the kill operation.
     * @returns Promise<void>.
     */
    kill(signal?: Signal, opts?: {
        abortSignal?: AbortSignal;
    }): Promise<void>;
}
/**
 * A command that has finished executing.
 *
 * The exit code is immediately available and populated upon creation.
 * Unlike {@link Command}, you don't need to call wait() - the command
 * has already completed execution.
 *
 * @hideconstructor
 */
export declare class CommandFinished extends Command {
    /**
     * The exit code of the command. This is always populated for
     * CommandFinished instances.
     */
    exitCode: number;
    /**
     * @param params - Object containing client, sandbox ID, command ID, and exit code.
     * @param params.client - API client used to interact with the backend.
     * @param params.sandboxId - The ID of the sandbox where the command ran.
     * @param params.cmdId - The ID of the command execution.
     * @param params.exitCode - The exit code of the completed command.
     */
    constructor(params: {
        client: APIClient;
        sandboxId: string;
        cmd: CommandData;
        exitCode: number;
    });
    /**
     * The wait method is not needed for CommandFinished instances since
     * the command has already completed and exitCode is populated.
     *
     * @deprecated This method is redundant for CommandFinished instances.
     * The exitCode is already available.
     * @returns This CommandFinished instance.
     */
    wait(): Promise<CommandFinished>;
}
