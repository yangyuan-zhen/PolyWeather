import type { Chain } from '../types';
import type { Prerender } from '../prerender';
/**
 * The Prerender chain can be defined as a `chain` property or as a flag
 * `experimentalStreamingLambdaPath`. This function normalizes the chain
 * to a single structure.
 */
export declare function getPrerenderChain(prerender: Prerender): Chain | undefined;
