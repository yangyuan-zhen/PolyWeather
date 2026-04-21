import type { PyProjectToml } from './pyproject/types';
import type { PipfileLike, PipfileLockLike } from './pipfile/types';
/**
 * Migrate a parsed Pipfile to a pyproject.toml object suitable for uv.
 *
 * This creates a minimal pyproject:
 *
 * [project]
 * dependencies = [...]
 *
 * [dependency-groups]
 * dev = [...]
 *
 * [tool.uv.sources] + [[tool.uv.index]]
 */
export declare function convertPipfileToPyprojectToml(pipfile: PipfileLike): PyProjectToml;
/**
 * Migrate a parsed Pipfile.lock to a pyproject.toml object suitable for uv.
 *
 * Pipfile.lock uses different key names than Pipfile:
 * - "default" instead of "packages"
 * - "develop" instead of "dev-packages"
 * - Custom categories use the same name in both files
 *
 * This creates a minimal pyproject:
 *
 * [project]
 * dependencies = [...]
 *
 * [dependency-groups]
 * dev = [...]
 *
 * [tool.uv.sources] + [[tool.uv.index]]
 */
export declare function convertPipfileLockToPyprojectToml(pipfileLock: PipfileLockLike): PyProjectToml;
