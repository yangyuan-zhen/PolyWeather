/**
 * Type guard to check if a value is a plain object (not null, array, or primitive).
 *
 * @param value - Value to check
 * @returns True if value is a plain object
 */
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
