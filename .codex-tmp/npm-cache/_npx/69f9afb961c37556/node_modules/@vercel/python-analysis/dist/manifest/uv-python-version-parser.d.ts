import type { Pep440Constraint } from './pep440';
import type { PythonRequest } from './python-specifiers';
/**
 * uv supports these request formats in --python and .python-version:
 * - <version> (e.g. 3, 3.12, 3.12.3)
 * - <version-specifier> (e.g. >=3.12,<3.13)
 * - <version><short-variant> (e.g. 3.13t, 3.12.0d)
 * - <version>+<variant> (e.g. 3.13+freethreaded, 3.12.0+debug, 3.14+gil)
 * - <implementation> (e.g. cpython or cp)
 * - <implementation>@<version>
 * - <implementation><version> (e.g. cpython3.12 or cp312)
 * - <implementation><version-specifier> (e.g. cpython>=3.12,<3.13)
 * - <implementation>-<version>-<os>-<arch>-<libc> (e.g. cpython-3.12.3-macos-aarch64-none)
 *
 * plus local interpreter requests, which we obviously cannot support
 * - <executable-path> (e.g. /opt/homebrew/bin/python3)
 * - <executable-name> (e.g. mypython3)
 * - <install-dir> (e.g. /some/environment/)
 */
export declare function pythonRequestFromConstraint(constraint: Pep440Constraint[]): PythonRequest;
/**
 * Parse the contents of a `.python-version` file.
 */
export declare function parsePythonVersionFile(content: string): PythonRequest[] | null;
/**
 * Parse a single uv python request (as in `--python ...` or `.python-version` contents).
 */
export declare function parseUvPythonRequest(input: string): PythonRequest | null;
