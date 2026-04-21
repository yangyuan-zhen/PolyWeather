import type { Diagnostics } from './types';
export interface PackageManifestDependency {
    name: string;
    type: 'direct' | 'transitive' | 'peer';
    scopes: string[];
    requested?: string;
    resolved: string;
    source?: string;
    sourceUrl?: string;
}
export interface PackageManifest {
    version?: string;
    runtime: string;
    runtimeVersion?: {
        requested?: string;
        requestedSource?: string;
        resolved: string;
    };
    dependencies: PackageManifestDependency[];
}
export declare const MANIFEST_VERSION = "20260304";
export declare const MANIFEST_FILENAME = "package-manifest.json";
export declare function manifestPath(runtime: string): string;
export declare function writeProjectManifest(manifest: PackageManifest, workPath: string, runtime: string): Promise<void>;
export declare function createDiagnostics(runtime: string): Diagnostics;
