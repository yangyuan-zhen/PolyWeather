/**
 * Returns an array from the given item. If the  item is an array it will be
 * returned as a it is, otherwise it will be returned as a single item array.
 * If the item is undefined or null an empty array will be returned.
 *
 * @param item The item to convert to an array.
 * @returns An array.
 */
export declare function array<T>(item?: null | T | T[]): T[];
