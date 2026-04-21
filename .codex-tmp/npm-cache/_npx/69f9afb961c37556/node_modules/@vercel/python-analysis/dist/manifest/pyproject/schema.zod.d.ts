import { z } from 'zod';
export declare const pyProjectBuildSystemSchema: z.ZodObject<{
    requires: z.ZodArray<z.ZodString, "many">;
    'build-backend': z.ZodOptional<z.ZodString>;
    'backend-path': z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    requires: string[];
    'build-backend'?: string | undefined;
    'backend-path'?: string[] | undefined;
}, {
    requires: string[];
    'build-backend'?: string | undefined;
    'backend-path'?: string[] | undefined;
}>;
export declare const personSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    email?: string | undefined;
}, {
    name?: string | undefined;
    email?: string | undefined;
}>;
export declare const readmeObjectSchema: z.ZodObject<{
    file: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    content_type: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    file: (string | string[]) & (string | string[] | undefined);
    content_type?: string | undefined;
}, {
    file: (string | string[]) & (string | string[] | undefined);
    content_type?: string | undefined;
}>;
export declare const readmeSchema: z.ZodUnion<[z.ZodString, z.ZodObject<{
    file: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    content_type: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    file: (string | string[]) & (string | string[] | undefined);
    content_type?: string | undefined;
}, {
    file: (string | string[]) & (string | string[] | undefined);
    content_type?: string | undefined;
}>]>;
export declare const licenseObjectSchema: z.ZodObject<{
    text: z.ZodOptional<z.ZodString>;
    file: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    text?: string | undefined;
    file?: string | undefined;
}, {
    text?: string | undefined;
    file?: string | undefined;
}>;
export declare const licenseSchema: z.ZodUnion<[z.ZodString, z.ZodObject<{
    text: z.ZodOptional<z.ZodString>;
    file: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    text?: string | undefined;
    file?: string | undefined;
}, {
    text?: string | undefined;
    file?: string | undefined;
}>]>;
export declare const pyProjectProjectSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    readme: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
        file: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
        content_type: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        file: (string | string[]) & (string | string[] | undefined);
        content_type?: string | undefined;
    }, {
        file: (string | string[]) & (string | string[] | undefined);
        content_type?: string | undefined;
    }>]>>;
    keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    authors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        email: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name?: string | undefined;
        email?: string | undefined;
    }, {
        name?: string | undefined;
        email?: string | undefined;
    }>, "many">>;
    maintainers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        email: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name?: string | undefined;
        email?: string | undefined;
    }, {
        name?: string | undefined;
        email?: string | undefined;
    }>, "many">>;
    license: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
        text: z.ZodOptional<z.ZodString>;
        file: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text?: string | undefined;
        file?: string | undefined;
    }, {
        text?: string | undefined;
        file?: string | undefined;
    }>]>>;
    classifiers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    urls: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    'optional-dependencies': z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
    dynamic: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    'requires-python': z.ZodOptional<z.ZodString>;
    scripts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    entry_points: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    version?: string | undefined;
    description?: string | undefined;
    readme?: string | {
        file: (string | string[]) & (string | string[] | undefined);
        content_type?: string | undefined;
    } | undefined;
    keywords?: string[] | undefined;
    authors?: {
        name?: string | undefined;
        email?: string | undefined;
    }[] | undefined;
    maintainers?: {
        name?: string | undefined;
        email?: string | undefined;
    }[] | undefined;
    license?: string | {
        text?: string | undefined;
        file?: string | undefined;
    } | undefined;
    classifiers?: string[] | undefined;
    urls?: Record<string, string> | undefined;
    dependencies?: string[] | undefined;
    'optional-dependencies'?: Record<string, string[]> | undefined;
    dynamic?: string[] | undefined;
    'requires-python'?: string | undefined;
    scripts?: Record<string, string> | undefined;
    entry_points?: Record<string, Record<string, string>> | undefined;
}, {
    name?: string | undefined;
    version?: string | undefined;
    description?: string | undefined;
    readme?: string | {
        file: (string | string[]) & (string | string[] | undefined);
        content_type?: string | undefined;
    } | undefined;
    keywords?: string[] | undefined;
    authors?: {
        name?: string | undefined;
        email?: string | undefined;
    }[] | undefined;
    maintainers?: {
        name?: string | undefined;
        email?: string | undefined;
    }[] | undefined;
    license?: string | {
        text?: string | undefined;
        file?: string | undefined;
    } | undefined;
    classifiers?: string[] | undefined;
    urls?: Record<string, string> | undefined;
    dependencies?: string[] | undefined;
    'optional-dependencies'?: Record<string, string[]> | undefined;
    dynamic?: string[] | undefined;
    'requires-python'?: string | undefined;
    scripts?: Record<string, string> | undefined;
    entry_points?: Record<string, Record<string, string>> | undefined;
}>;
export declare const dependencyGroupIncludeSchema: z.ZodObject<{
    'include-group': z.ZodString;
}, "strip", z.ZodTypeAny, {
    'include-group': string;
}, {
    'include-group': string;
}>;
export declare const dependencyGroupEntrySchema: z.ZodUnion<[z.ZodString, z.ZodObject<{
    'include-group': z.ZodString;
}, "strip", z.ZodTypeAny, {
    'include-group': string;
}, {
    'include-group': string;
}>]>;
export declare const pyProjectDependencyGroupsSchema: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
    'include-group': z.ZodString;
}, "strip", z.ZodTypeAny, {
    'include-group': string;
}, {
    'include-group': string;
}>]>, "many">>;
export declare const pyProjectToolSectionSchema: z.ZodObject<{
    uv: z.ZodOptional<z.ZodObject<{
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
    }>>;
}, "strip", z.ZodTypeAny, {
    uv?: {
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
    } | undefined;
}, {
    uv?: {
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
    } | undefined;
}>;
export declare const pyProjectTomlSchema: z.ZodObject<{
    project: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        readme: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            file: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
            content_type: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        }, {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        }>]>>;
        keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        authors: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            email: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name?: string | undefined;
            email?: string | undefined;
        }, {
            name?: string | undefined;
            email?: string | undefined;
        }>, "many">>;
        maintainers: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            email: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name?: string | undefined;
            email?: string | undefined;
        }, {
            name?: string | undefined;
            email?: string | undefined;
        }>, "many">>;
        license: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            text: z.ZodOptional<z.ZodString>;
            file: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            text?: string | undefined;
            file?: string | undefined;
        }, {
            text?: string | undefined;
            file?: string | undefined;
        }>]>>;
        classifiers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        urls: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        'optional-dependencies': z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
        dynamic: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        'requires-python': z.ZodOptional<z.ZodString>;
        scripts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        entry_points: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
    }, "strip", z.ZodTypeAny, {
        name?: string | undefined;
        version?: string | undefined;
        description?: string | undefined;
        readme?: string | {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        } | undefined;
        keywords?: string[] | undefined;
        authors?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        maintainers?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        license?: string | {
            text?: string | undefined;
            file?: string | undefined;
        } | undefined;
        classifiers?: string[] | undefined;
        urls?: Record<string, string> | undefined;
        dependencies?: string[] | undefined;
        'optional-dependencies'?: Record<string, string[]> | undefined;
        dynamic?: string[] | undefined;
        'requires-python'?: string | undefined;
        scripts?: Record<string, string> | undefined;
        entry_points?: Record<string, Record<string, string>> | undefined;
    }, {
        name?: string | undefined;
        version?: string | undefined;
        description?: string | undefined;
        readme?: string | {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        } | undefined;
        keywords?: string[] | undefined;
        authors?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        maintainers?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        license?: string | {
            text?: string | undefined;
            file?: string | undefined;
        } | undefined;
        classifiers?: string[] | undefined;
        urls?: Record<string, string> | undefined;
        dependencies?: string[] | undefined;
        'optional-dependencies'?: Record<string, string[]> | undefined;
        dynamic?: string[] | undefined;
        'requires-python'?: string | undefined;
        scripts?: Record<string, string> | undefined;
        entry_points?: Record<string, Record<string, string>> | undefined;
    }>>;
    'build-system': z.ZodOptional<z.ZodObject<{
        requires: z.ZodArray<z.ZodString, "many">;
        'build-backend': z.ZodOptional<z.ZodString>;
        'backend-path': z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        requires: string[];
        'build-backend'?: string | undefined;
        'backend-path'?: string[] | undefined;
    }, {
        requires: string[];
        'build-backend'?: string | undefined;
        'backend-path'?: string[] | undefined;
    }>>;
    'dependency-groups': z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
        'include-group': z.ZodString;
    }, "strip", z.ZodTypeAny, {
        'include-group': string;
    }, {
        'include-group': string;
    }>]>, "many">>>;
    tool: z.ZodOptional<z.ZodObject<{
        uv: z.ZodOptional<z.ZodObject<{
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
        }>>;
    }, "strip", z.ZodTypeAny, {
        uv?: {
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
        } | undefined;
    }, {
        uv?: {
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
        } | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    project?: {
        name?: string | undefined;
        version?: string | undefined;
        description?: string | undefined;
        readme?: string | {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        } | undefined;
        keywords?: string[] | undefined;
        authors?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        maintainers?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        license?: string | {
            text?: string | undefined;
            file?: string | undefined;
        } | undefined;
        classifiers?: string[] | undefined;
        urls?: Record<string, string> | undefined;
        dependencies?: string[] | undefined;
        'optional-dependencies'?: Record<string, string[]> | undefined;
        dynamic?: string[] | undefined;
        'requires-python'?: string | undefined;
        scripts?: Record<string, string> | undefined;
        entry_points?: Record<string, Record<string, string>> | undefined;
    } | undefined;
    'build-system'?: {
        requires: string[];
        'build-backend'?: string | undefined;
        'backend-path'?: string[] | undefined;
    } | undefined;
    'dependency-groups'?: Record<string, (string | {
        'include-group': string;
    })[]> | undefined;
    tool?: {
        uv?: {
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
        } | undefined;
    } | undefined;
}, {
    project?: {
        name?: string | undefined;
        version?: string | undefined;
        description?: string | undefined;
        readme?: string | {
            file: (string | string[]) & (string | string[] | undefined);
            content_type?: string | undefined;
        } | undefined;
        keywords?: string[] | undefined;
        authors?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        maintainers?: {
            name?: string | undefined;
            email?: string | undefined;
        }[] | undefined;
        license?: string | {
            text?: string | undefined;
            file?: string | undefined;
        } | undefined;
        classifiers?: string[] | undefined;
        urls?: Record<string, string> | undefined;
        dependencies?: string[] | undefined;
        'optional-dependencies'?: Record<string, string[]> | undefined;
        dynamic?: string[] | undefined;
        'requires-python'?: string | undefined;
        scripts?: Record<string, string> | undefined;
        entry_points?: Record<string, Record<string, string>> | undefined;
    } | undefined;
    'build-system'?: {
        requires: string[];
        'build-backend'?: string | undefined;
        'backend-path'?: string[] | undefined;
    } | undefined;
    'dependency-groups'?: Record<string, (string | {
        'include-group': string;
    })[]> | undefined;
    tool?: {
        uv?: {
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
        } | undefined;
    } | undefined;
}>;
