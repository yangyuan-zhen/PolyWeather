import FileFsRef from './file-fs-ref';
/**
 * Check if a Python file is a valid entrypoint by detecting:
 * - A top-level 'app' callable (Flask, FastAPI, Sanic, WSGI/ASGI, etc.)
 * - A top-level 'application' callable (Django)
 * - A top-level 'handler' class (BaseHTTPRequestHandler subclass)
 */
export declare function isPythonEntrypoint(file: FileFsRef | {
    fsPath?: string;
}): Promise<boolean>;
