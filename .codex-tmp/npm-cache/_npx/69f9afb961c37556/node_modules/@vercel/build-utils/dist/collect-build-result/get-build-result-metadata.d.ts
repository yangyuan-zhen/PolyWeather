import type { Route } from '@vercel/routing-utils';
import type { EdgeFunction } from '../edge-function';
import type { File } from '../types';
import type { Lambda } from '../lambda';
import type { Prerender } from '../prerender';
export interface BuildResultMetadata {
    middleware: Map<string, MiddlewareMeta>;
    ppr: Map<string, boolean>;
}
/**
 * Extract metadata about the build result that depend on the relationship
 * between components in the build output. This data is later used to map to
 * the infrastructure that we need to create.
 */
export declare function getBuildResultMetadata(params: {
    buildOutputMap: Record<string, EdgeFunction | Lambda | Prerender | File>;
    routes: Route[];
}): BuildResultMetadata;
type MiddlewareMeta = {
    type: 'middleware';
    middlewarePath: string;
    outputPath: string;
    match: Set<string>;
    edgeFunction: EdgeFunction;
    index: number;
} | {
    type: 'middleware-lambda';
    middlewarePath: string;
    outputPath: string;
    match: Set<string>;
    index: number;
};
export {};
