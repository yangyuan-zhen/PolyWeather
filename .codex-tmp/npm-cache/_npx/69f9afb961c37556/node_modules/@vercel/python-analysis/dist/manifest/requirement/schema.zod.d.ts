import { z } from 'zod';
export declare const dependencySourceSchema: z.ZodObject<{
    index: z.ZodOptional<z.ZodString>;
    git: z.ZodOptional<z.ZodString>;
    rev: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    editable: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    index?: string | undefined;
    git?: string | undefined;
    rev?: string | undefined;
    path?: string | undefined;
    editable?: boolean | undefined;
}, {
    index?: string | undefined;
    git?: string | undefined;
    rev?: string | undefined;
    path?: string | undefined;
    editable?: boolean | undefined;
}>;
export declare const normalizedRequirementSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodOptional<z.ZodString>;
    extras: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    markers: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    source: z.ZodOptional<z.ZodObject<{
        index: z.ZodOptional<z.ZodString>;
        git: z.ZodOptional<z.ZodString>;
        rev: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        editable: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    }, {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version?: string | undefined;
    extras?: string[] | undefined;
    markers?: string | undefined;
    url?: string | undefined;
    hashes?: string[] | undefined;
    source?: {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    } | undefined;
}, {
    name: string;
    version?: string | undefined;
    extras?: string[] | undefined;
    markers?: string | undefined;
    url?: string | undefined;
    hashes?: string[] | undefined;
    source?: {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    } | undefined;
}>;
export declare const hashDigestSchema: z.ZodString;
