/**
 * Utility type that extends a type to accept private parameters.
 *
 * The private parameters can then be extracted out of the object using
 * `getPrivateParams`.
 */
export type WithPrivate<T> = T & {
    [K in `__${string}`]?: unknown;
};
/**
 * Extract private parameters out of an object.
 */
export declare const getPrivateParams: (params?: object) => { [K in keyof typeof params as K extends `__${string}` ? K : never]: (typeof params)[K]; };
