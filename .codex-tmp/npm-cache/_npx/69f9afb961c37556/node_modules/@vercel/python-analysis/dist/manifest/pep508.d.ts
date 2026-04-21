/**
 * Shared utilities for PEP 508 dependency string formatting and normalization.
 *
 * PEP 508 defines the format for Python dependency specifiers:
 * https://peps.python.org/pep-0508/
 *
 * Format: name[extras] (version) @ url ; markers
 * Examples:
 *   - requests>=2.0
 *   - requests[security]>=2.0
 *   - mypackage @ https://example.com/pkg.zip
 *   - requests>=2.0 ; python_version >= "3.8"
 */
import type { NormalizedRequirement } from './requirement/types';
/**
 * Split a package specification into name and extras.
 *
 * @param spec - Package specification that may include extras (e.g., "requests[security,socks]")
 * @returns Tuple of [name, extras] where extras is undefined if not present
 *
 * @example
 * splitExtras("requests") // ["requests", undefined]
 * splitExtras("requests[security]") // ["requests", ["security"]]
 * splitExtras("requests[security,socks]") // ["requests", ["security", "socks"]]
 */
export declare function splitExtras(spec: string): [string, string[] | undefined];
/**
 * Normalize a Python package name according to PEP 503.
 *
 * PEP 503 specifies that package names should be compared case-insensitively
 * and with underscores, hyphens, and periods treated as equivalent.
 *
 * @param name - Package name to normalize
 * @returns Lowercase name with separators normalized to hyphens
 *
 * @example
 * normalizePackageName("My_Package.Name") // "my-package-name"
 */
export declare function normalizePackageName(name: string): string;
/**
 * Format a normalized requirement as a PEP 508 dependency string.
 *
 * @param req - Normalized requirement to format
 * @returns PEP 508 formatted string
 *
 * @example
 * formatPep508({ name: "requests", version: ">=2.0" })
 * // "requests>=2.0"
 *
 * formatPep508({ name: "mypackage", url: "https://example.com/pkg.zip" })
 * // "mypackage @ https://example.com/pkg.zip"
 *
 * formatPep508({ name: "requests", version: ">=2.0", extras: ["security"], markers: "python_version >= '3.8'" })
 * // "requests[security]>=2.0 ; python_version >= '3.8'"
 */
export declare function formatPep508(req: NormalizedRequirement): string;
/**
 * Merge extras arrays, combining and deduplicating entries.
 *
 * @param existing - Existing extras array (may be undefined)
 * @param additional - Additional extras to merge (may be undefined or a single string)
 * @returns Merged extras array, or undefined if both inputs are empty/undefined
 */
export declare function mergeExtras(existing: string[] | undefined, additional: string[] | string | undefined): string[] | undefined;
/**
 * Parse a single PEP 508 dependency string into a NormalizedRequirement.
 *
 * Uses the uv-pep508 Rust crate via WASM for spec-compliant parsing.
 *
 * @param dep - A PEP 508 dependency string (e.g., "flask[async]>=2.0 ; python_version >= '3.8'")
 * @returns The parsed requirement, or null if parsing fails
 */
export declare function parsePep508(dep: string): Promise<NormalizedRequirement | null>;
/**
 * Parse multiple PEP 508 dependency strings in a single batch.
 *
 * Loads the WASM module once and parses all strings synchronously,
 * avoiding per-item async overhead.
 *
 * @param deps - Array of PEP 508 dependency strings
 * @returns Array of parsed requirements (null for entries that fail to parse)
 */
export declare function parsePep508(deps: string[]): Promise<(NormalizedRequirement | null)[]>;
