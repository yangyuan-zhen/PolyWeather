export declare const isErrnoException: (error: unknown, code?: string | undefined) => error is NodeJS.ErrnoException;
interface PythonAnalysisErrorProps {
    /**
     * The error message to display to the end-user.
     * Should be short yet descriptive of what went wrong.
     */
    message: string;
    /**
     * A unique error code for this particular error.
     * Should start with `PYTHON_` prefix.
     */
    code: string;
    /**
     * The path to the file that caused the error, if applicable.
     */
    path?: string;
    /**
     * Optional hyperlink to documentation with more information about this error.
     */
    link?: string;
    /**
     * Optional "action" to display before the `link`, such as "Learn More".
     */
    action?: string;
    /**
     * The raw content of the file that failed to parse, if available.
     * Useful for diagnostic logging by callers.
     */
    fileContent?: string;
}
/**
 * This error should be thrown from Python analysis functions
 * when encountering configuration or manifest parsing errors.
 * This is necessary to provide clear error messages without stack traces.
 */
export declare class PythonAnalysisError extends Error {
    hideStackTrace: boolean;
    code: string;
    path?: string;
    link?: string;
    action?: string;
    fileContent?: string;
    constructor({ message, code, path, link, action, fileContent, }: PythonAnalysisErrorProps);
}
export {};
