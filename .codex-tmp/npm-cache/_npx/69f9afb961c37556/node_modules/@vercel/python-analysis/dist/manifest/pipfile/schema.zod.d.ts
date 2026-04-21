import { z } from 'zod';
export declare const pipfileDependencyDetailSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodString>;
    hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
    markers: z.ZodOptional<z.ZodString>;
    index: z.ZodOptional<z.ZodString>;
    git: z.ZodOptional<z.ZodString>;
    ref: z.ZodOptional<z.ZodString>;
    editable: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}>;
export declare const pipfileDependencySchema: z.ZodUnion<[z.ZodString, z.ZodObject<{
    version: z.ZodOptional<z.ZodString>;
    hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
    markers: z.ZodOptional<z.ZodString>;
    index: z.ZodOptional<z.ZodString>;
    git: z.ZodOptional<z.ZodString>;
    ref: z.ZodOptional<z.ZodString>;
    editable: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}>]>;
export declare const pipfileSourceSchema: z.ZodObject<{
    name: z.ZodString;
    url: z.ZodString;
    verify_ssl: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    url: string;
    verify_ssl?: boolean | undefined;
}, {
    name: string;
    url: string;
    verify_ssl?: boolean | undefined;
}>;
export declare const pipfileLikeSchema: z.ZodIntersection<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodObject<{
    version: z.ZodOptional<z.ZodString>;
    hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
    markers: z.ZodOptional<z.ZodString>;
    index: z.ZodOptional<z.ZodString>;
    git: z.ZodOptional<z.ZodString>;
    ref: z.ZodOptional<z.ZodString>;
    editable: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}>]>>, z.ZodArray<z.ZodObject<{
    name: z.ZodString;
    url: z.ZodString;
    verify_ssl: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    url: string;
    verify_ssl?: boolean | undefined;
}, {
    name: string;
    url: string;
    verify_ssl?: boolean | undefined;
}>, "many">, z.ZodRecord<z.ZodString, z.ZodString>, z.ZodUndefined]>>, z.ZodObject<{
    packages: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodObject<{
        version: z.ZodOptional<z.ZodString>;
        hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
        markers: z.ZodOptional<z.ZodString>;
        index: z.ZodOptional<z.ZodString>;
        git: z.ZodOptional<z.ZodString>;
        ref: z.ZodOptional<z.ZodString>;
        editable: z.ZodOptional<z.ZodBoolean>;
        path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }>]>>>;
    'dev-packages': z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodObject<{
        version: z.ZodOptional<z.ZodString>;
        hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
        markers: z.ZodOptional<z.ZodString>;
        index: z.ZodOptional<z.ZodString>;
        git: z.ZodOptional<z.ZodString>;
        ref: z.ZodOptional<z.ZodString>;
        editable: z.ZodOptional<z.ZodBoolean>;
        path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }>]>>>;
    source: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodString;
        verify_ssl: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }>, "many">>;
    scripts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    packages?: Record<string, string | {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    'dev-packages'?: Record<string, string | {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    source?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
    scripts?: Record<string, string> | undefined;
}, {
    packages?: Record<string, string | {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    'dev-packages'?: Record<string, string | {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    source?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
    scripts?: Record<string, string> | undefined;
}>>;
export declare const pipfileLockMetaSchema: z.ZodObject<{
    hash: z.ZodOptional<z.ZodObject<{
        sha256: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sha256?: string | undefined;
    }, {
        sha256?: string | undefined;
    }>>;
    'pipfile-spec': z.ZodOptional<z.ZodNumber>;
    requires: z.ZodOptional<z.ZodObject<{
        python_version: z.ZodOptional<z.ZodString>;
        python_full_version: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    }, {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    }>>;
    sources: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodString;
        verify_ssl: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    hash?: {
        sha256?: string | undefined;
    } | undefined;
    'pipfile-spec'?: number | undefined;
    requires?: {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    } | undefined;
    sources?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
}, {
    hash?: {
        sha256?: string | undefined;
    } | undefined;
    'pipfile-spec'?: number | undefined;
    requires?: {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    } | undefined;
    sources?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
}>;
export declare const pipfileLockLikeSchema: z.ZodIntersection<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodObject<{
    hash: z.ZodOptional<z.ZodObject<{
        sha256: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sha256?: string | undefined;
    }, {
        sha256?: string | undefined;
    }>>;
    'pipfile-spec': z.ZodOptional<z.ZodNumber>;
    requires: z.ZodOptional<z.ZodObject<{
        python_version: z.ZodOptional<z.ZodString>;
        python_full_version: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    }, {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    }>>;
    sources: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        url: z.ZodString;
        verify_ssl: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }, {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    hash?: {
        sha256?: string | undefined;
    } | undefined;
    'pipfile-spec'?: number | undefined;
    requires?: {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    } | undefined;
    sources?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
}, {
    hash?: {
        sha256?: string | undefined;
    } | undefined;
    'pipfile-spec'?: number | undefined;
    requires?: {
        python_version?: string | undefined;
        python_full_version?: string | undefined;
    } | undefined;
    sources?: {
        name: string;
        url: string;
        verify_ssl?: boolean | undefined;
    }[] | undefined;
}>, z.ZodRecord<z.ZodString, z.ZodObject<{
    version: z.ZodOptional<z.ZodString>;
    hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
    markers: z.ZodOptional<z.ZodString>;
    index: z.ZodOptional<z.ZodString>;
    git: z.ZodOptional<z.ZodString>;
    ref: z.ZodOptional<z.ZodString>;
    editable: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}, {
    version?: string | undefined;
    hashes?: string[] | undefined;
    extras?: string | string[] | undefined;
    markers?: string | undefined;
    index?: string | undefined;
    git?: string | undefined;
    ref?: string | undefined;
    editable?: boolean | undefined;
    path?: string | undefined;
}>>, z.ZodUndefined]>>, z.ZodObject<{
    _meta: z.ZodOptional<z.ZodObject<{
        hash: z.ZodOptional<z.ZodObject<{
            sha256: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            sha256?: string | undefined;
        }, {
            sha256?: string | undefined;
        }>>;
        'pipfile-spec': z.ZodOptional<z.ZodNumber>;
        requires: z.ZodOptional<z.ZodObject<{
            python_version: z.ZodOptional<z.ZodString>;
            python_full_version: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        }, {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        }>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            url: z.ZodString;
            verify_ssl: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }, {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        hash?: {
            sha256?: string | undefined;
        } | undefined;
        'pipfile-spec'?: number | undefined;
        requires?: {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        } | undefined;
        sources?: {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }[] | undefined;
    }, {
        hash?: {
            sha256?: string | undefined;
        } | undefined;
        'pipfile-spec'?: number | undefined;
        requires?: {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        } | undefined;
        sources?: {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }[] | undefined;
    }>>;
    default: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        version: z.ZodOptional<z.ZodString>;
        hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
        markers: z.ZodOptional<z.ZodString>;
        index: z.ZodOptional<z.ZodString>;
        git: z.ZodOptional<z.ZodString>;
        ref: z.ZodOptional<z.ZodString>;
        editable: z.ZodOptional<z.ZodBoolean>;
        path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }>>>;
    develop: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        version: z.ZodOptional<z.ZodString>;
        hashes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        extras: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodString]>>;
        markers: z.ZodOptional<z.ZodString>;
        index: z.ZodOptional<z.ZodString>;
        git: z.ZodOptional<z.ZodString>;
        ref: z.ZodOptional<z.ZodString>;
        editable: z.ZodOptional<z.ZodBoolean>;
        path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    _meta?: {
        hash?: {
            sha256?: string | undefined;
        } | undefined;
        'pipfile-spec'?: number | undefined;
        requires?: {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        } | undefined;
        sources?: {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }[] | undefined;
    } | undefined;
    default?: Record<string, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    develop?: Record<string, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
}, {
    _meta?: {
        hash?: {
            sha256?: string | undefined;
        } | undefined;
        'pipfile-spec'?: number | undefined;
        requires?: {
            python_version?: string | undefined;
            python_full_version?: string | undefined;
        } | undefined;
        sources?: {
            name: string;
            url: string;
            verify_ssl?: boolean | undefined;
        }[] | undefined;
    } | undefined;
    default?: Record<string, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
    develop?: Record<string, {
        version?: string | undefined;
        hashes?: string[] | undefined;
        extras?: string | string[] | undefined;
        markers?: string | undefined;
        index?: string | undefined;
        git?: string | undefined;
        ref?: string | undefined;
        editable?: boolean | undefined;
        path?: string | undefined;
    }> | undefined;
}>>;
