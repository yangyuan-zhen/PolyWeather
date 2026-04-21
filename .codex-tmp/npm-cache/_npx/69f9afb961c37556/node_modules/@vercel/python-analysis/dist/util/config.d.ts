import { z } from 'zod';
/**
 * Parse config content and validate it against a zod schema.
 *
 * @param content - Raw file content
 * @param filename - File path (used for error messages and format detection)
 * @param schema - Zod schema to validate against
 * @param filetype - Optional file type override (e.g., '.toml', '.json')
 * @returns Validated and typed config object
 */
export declare function parseConfig<T>(content: string, filename: string, schema: z.ZodType<T>, filetype?: string | undefined): T;
/**
 * Read a config file if it exists and validate it against a zod schema.
 *
 * @param filename - Path to the config file
 * @param schema - Zod schema to validate against
 * @param filetype - Optional file type override (e.g., '.toml', '.json')
 * @returns Validated config object, or null if file doesn't exist
 */
export declare function readConfigIfExists<T>(filename: string, schema: z.ZodType<T>, filetype?: string | undefined): Promise<T | null>;
