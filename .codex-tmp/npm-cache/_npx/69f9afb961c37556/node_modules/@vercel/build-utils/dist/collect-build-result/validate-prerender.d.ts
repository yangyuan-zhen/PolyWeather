import type { Lambda } from '../lambda';
interface PrerenderLike {
    lambda?: Lambda;
}
export declare function validatePrerender(prerender: PrerenderLike): asserts prerender is {
    lambda: Lambda;
};
export {};
