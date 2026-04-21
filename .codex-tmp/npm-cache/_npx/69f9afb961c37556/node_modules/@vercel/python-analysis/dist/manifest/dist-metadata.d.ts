/**
 * Installed distribution metadata scanning.
 *
 * Scans a site-packages directory for .dist-info subdirectories and parses
 * their metadata using WASM-based parsers.
 *
 * Nomenclature strives to follow that of Python's importlib.metadata module:
 * https://docs.python.org/3/library/importlib.metadata.html
 */
/** A file record from a RECORD file (analogous to importlib.metadata.PackagePath). */
export interface PackagePath {
    path: string;
    hash?: string;
    size?: bigint;
}
/** PEP 610 direct URL origin info (analogous to importlib.metadata.Distribution.origin). */
export type DirectUrlInfo = {
    tag: 'local-directory';
    val: {
        url: string;
        editable: boolean;
    };
} | {
    tag: 'archive';
    val: {
        url: string;
        hash?: string;
    };
} | {
    tag: 'vcs';
    val: {
        url: string;
        vcs: string;
        commitId?: string;
        requestedRevision?: string;
    };
};
/**
 * An installed distribution parsed from a .dist-info directory.
 * Analogous to importlib.metadata.Distribution.
 */
export interface Distribution {
    /** Normalized package name (PEP 503). */
    name: string;
    /** Package version string. */
    version: string;
    /** Metadata version (e.g. "2.1", "2.3"). */
    metadataVersion: string;
    /** One-line summary. */
    summary?: string;
    /** Full description. */
    description?: string;
    /** Description content type (e.g. "text/markdown"). */
    descriptionContentType?: string;
    /** PEP 508 dependency specifiers (analogous to importlib.metadata.requires()). */
    requiresDist: string[];
    /** Python version requirement (e.g. ">=3.8"). */
    requiresPython?: string;
    /** Extra names provided by this distribution. */
    providesExtra: string[];
    /** Author name. */
    author?: string;
    /** Author email. */
    authorEmail?: string;
    /** Maintainer name. */
    maintainer?: string;
    /** Maintainer email. */
    maintainerEmail?: string;
    /** License text. */
    license?: string;
    /** SPDX license expression. */
    licenseExpression?: string;
    /** Trove classifiers. */
    classifiers: string[];
    /** Home page URL. */
    homePage?: string;
    /** Project URLs as [label, url] pairs. */
    projectUrls: [string, string][];
    /** Supported platforms. */
    platforms: string[];
    /** Dynamic metadata fields. */
    dynamic: string[];
    /** Installed files from RECORD (analogous to importlib.metadata.files()). */
    files: PackagePath[];
    /** PEP 610 origin info (analogous to importlib.metadata.Distribution.origin). */
    origin?: DirectUrlInfo;
    /** Installer tool name (from INSTALLER file). */
    installer?: string;
}
/** Map of normalized package name to distribution info. */
export type DistributionIndex = Map<string, Distribution>;
/**
 * Scan a site-packages directory for installed distributions.
 *
 * Reads .dist-info directories and parses their METADATA, RECORD,
 * direct_url.json, and INSTALLER files.
 *
 * Analogous to importlib.metadata.distributions() but returns an indexed map.
 *
 * @param sitePackagesDir - Absolute path to a site-packages directory
 * @returns Map of normalized package name to distribution info
 */
export declare function scanDistributions(sitePackagesDir: string): Promise<DistributionIndex>;
/**
 * Append new file entries to a distribution's RECORD file.
 *
 * Finds the `.dist-info` directory for the given package, reads its RECORD,
 * and appends any paths not already tracked. The caller is responsible for
 * scanning directories and building the path list.
 *
 * @param sitePackagesDir - Absolute path to a site-packages directory
 * @param packageName - Distribution name (matched via PEP 503 normalization)
 * @param paths - File paths relative to site-packages to add
 * @returns Count of new entries appended (skips paths already in RECORD)
 * @throws If the dist-info directory or RECORD file is not found
 */
export declare function extendDistRecord(sitePackagesDir: string, packageName: string, paths: string[]): Promise<number>;
