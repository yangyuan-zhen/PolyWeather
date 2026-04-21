/**
 * @vercel/python-analysis - Python package manifest discovery and analysis.
 *
 * This is the main entrypoint providing both runtime and type exports.
 * For types-only imports (to avoid bundling Zod), use '@vercel/python-analysis/types'.
 *
 * @module @vercel/python-analysis
 */
export { findAppOrHandler, containsTopLevelCallable, getStringConstant, } from './semantic/entrypoints';
export type { Distribution, DistributionIndex, PackagePath, DirectUrlInfo, } from './manifest/dist-metadata';
export { extendDistRecord, scanDistributions } from './manifest/dist-metadata';
export type { PythonConfig, PythonConfigs, PythonLockFile, PythonManifest, PythonManifestOrigin, PythonPackage, PythonVersionConfig, } from './manifest/package';
export { discoverPythonPackage, PythonConfigKind, PythonLockFileKind, PythonManifestConvertedKind, PythonManifestKind, } from './manifest/package';
export { createMinimalManifest, stringifyManifest, type CreateMinimalManifestOptions, } from './manifest/serialize';
export type { ClassifyPackagesOptions, PackageClassification, UvLockFile, UvLockPackage, UvLockPackageSource, UvLockWheel, } from './manifest/uv-lock-parser';
export { classifyPackages, isPrivatePackageSource, normalizePackageName, parseUvLock, } from './manifest/uv-lock-parser';
export { evaluateMarker, isWheelCompatible, } from './manifest/wheel-compat';
export type { PythonSelectionResult, PythonVersionSelectionResult, } from './manifest/python-selector';
export { selectPython, selectPythonVersion } from './manifest/python-selector';
export { PythonAnalysisError } from './util/error';
export { LicenseObjectSchema, LicenseSchema, PersonSchema, PyProjectBuildSystemSchema, PyProjectDependencyGroupsSchema, PyProjectProjectSchema, PyProjectToolSectionSchema, PyProjectTomlSchema, ReadmeObjectSchema, ReadmeSchema, } from './manifest/pyproject/schema';
export type { DependencyGroupEntry, DependencyGroupInclude, License, LicenseObject, Person, PyProjectBuildSystem, PyProjectDependencyGroups, PyProjectProject, PyProjectToml, PyProjectToolSection, Readme, ReadmeObject, } from './manifest/pyproject/types';
export { UvConfigSchema, UvConfigWorkspaceSchema, UvIndexEntrySchema, } from './manifest/uv-config/schema';
export type { UvConfig, UvConfigWorkspace, UvIndexEntry, } from './manifest/uv-config/types';
export { PipfileDependencyDetailSchema, PipfileDependencySchema, PipfileLikeSchema, PipfileLockLikeSchema, PipfileLockMetaSchema, PipfileSourceSchema, } from './manifest/pipfile/schema';
export type { PipfileDependency, PipfileDependencyDetail, PipfileLike, PipfileLockLike, PipfileLockMeta, PipfileSource, } from './manifest/pipfile/types';
export { DependencySourceSchema, HashDigestSchema, NormalizedRequirementSchema, } from './manifest/requirement/schema';
export type { DependencySource, HashDigest, NormalizedRequirement, } from './manifest/requirement/types';
export { parsePep508 } from './manifest/pep508';
export { PythonBuild, PythonConstraint, PythonImplementation, PythonPlatformRequest, PythonRequest, PythonVariant, PythonVersion, PythonVersionRequest, UnknownPythonImplementation, } from './manifest/python-specifiers';
