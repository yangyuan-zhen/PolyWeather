import { z } from 'zod';
export declare const uvConfigWorkspaceSchema: z.ZodObject<{
    members: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    members?: string[] | undefined;
    exclude?: string[] | undefined;
}, {
    members?: string[] | undefined;
    exclude?: string[] | undefined;
}>;
export declare const uvIndexEntrySchema: z.ZodObject<{
    name: z.ZodString;
    url: z.ZodString;
    default: z.ZodOptional<z.ZodBoolean>;
    explicit: z.ZodOptional<z.ZodBoolean>;
    format: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    url: string;
    default?: boolean | undefined;
    explicit?: boolean | undefined;
    format?: string | undefined;
}, {
    name: string;
    url: string;
    default?: boolean | undefined;
    explicit?: boolean | undefined;
    format?: string | undefined;
}>;
export declare const uvConfigSchema: z.ZodObject<{
    sources: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodObject<{
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
    }>, z.ZodArray<z.ZodObject<{
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
    }>, "many">]>>>;
    index: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodString;
        default: z.ZodOptional<z.ZodBoolean>;
        explicit: z.ZodOptional<z.ZodBoolean>;
        format: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        url: string;
        default?: boolean | undefined;
        explicit?: boolean | undefined;
        format?: string | undefined;
    }, {
        name: string;
        url: string;
        default?: boolean | undefined;
        explicit?: boolean | undefined;
        format?: string | undefined;
    }>, "many">>;
    workspace: z.ZodOptional<z.ZodObject<{
        members: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        members?: string[] | undefined;
        exclude?: string[] | undefined;
    }, {
        members?: string[] | undefined;
        exclude?: string[] | undefined;
    }>>;
    'dev-dependencies': z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    sources?: Record<string, {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    } | {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    }[]> | undefined;
    index?: {
        name: string;
        url: string;
        default?: boolean | undefined;
        explicit?: boolean | undefined;
        format?: string | undefined;
    }[] | undefined;
    workspace?: {
        members?: string[] | undefined;
        exclude?: string[] | undefined;
    } | undefined;
    'dev-dependencies'?: string[] | undefined;
}, {
    sources?: Record<string, {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    } | {
        index?: string | undefined;
        git?: string | undefined;
        rev?: string | undefined;
        path?: string | undefined;
        editable?: boolean | undefined;
    }[]> | undefined;
    index?: {
        name: string;
        url: string;
        default?: boolean | undefined;
        explicit?: boolean | undefined;
        format?: string | undefined;
    }[] | undefined;
    workspace?: {
        members?: string[] | undefined;
        exclude?: string[] | undefined;
    } | undefined;
    'dev-dependencies'?: string[] | undefined;
}>;
