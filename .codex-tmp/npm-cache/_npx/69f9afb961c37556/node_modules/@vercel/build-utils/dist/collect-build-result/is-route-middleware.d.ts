import type { Route } from '@vercel/routing-utils';
export declare function isRouteMiddleware(route: Route): route is Route & {
    middlewarePath: string;
};
