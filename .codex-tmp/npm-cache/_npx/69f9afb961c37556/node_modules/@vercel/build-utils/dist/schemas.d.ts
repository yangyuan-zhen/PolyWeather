export declare const functionsSchema: {
    type: string;
    minProperties: number;
    maxProperties: number;
    additionalProperties: boolean;
    patternProperties: {
        '^.{1,256}$': {
            type: string;
            additionalProperties: boolean;
            properties: {
                architecture: {
                    type: string;
                    enum: string[];
                };
                runtime: {
                    type: string;
                    maxLength: number;
                };
                memory: {
                    minimum: number;
                    maximum: number;
                };
                maxDuration: {
                    oneOf: ({
                        type: string;
                        minimum: number;
                        maximum: number;
                        enum?: undefined;
                    } | {
                        type: string;
                        enum: string[];
                        minimum?: undefined;
                        maximum?: undefined;
                    })[];
                };
                regions: {
                    type: string;
                    items: {
                        type: string;
                    };
                };
                functionFailoverRegions: {
                    type: string;
                    items: {
                        type: string;
                    };
                };
                includeFiles: {
                    type: string;
                    maxLength: number;
                };
                excludeFiles: {
                    type: string;
                    maxLength: number;
                };
                experimentalTriggers: {
                    type: string;
                    items: {
                        oneOf: {
                            type: string;
                            properties: {
                                type: {
                                    type: string;
                                    const: string;
                                };
                                topic: {
                                    type: string;
                                    minLength: number;
                                };
                                maxDeliveries: {
                                    type: string;
                                    minimum: number;
                                };
                                retryAfterSeconds: {
                                    type: string;
                                    exclusiveMinimum: number;
                                };
                                initialDelaySeconds: {
                                    type: string;
                                    minimum: number;
                                };
                                maxConcurrency: {
                                    type: string;
                                    minimum: number;
                                };
                            };
                            required: string[];
                            additionalProperties: boolean;
                        }[];
                    };
                };
                supportsCancellation: {
                    type: string;
                };
            };
        };
    };
};
export declare const buildsSchema: {
    type: string;
    minItems: number;
    maxItems: number;
    items: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            src: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            use: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            config: {
                type: string;
            };
        };
    };
};
/**
 * JSON Schema for builder-produced `package-manifest.json` files.
 *
 * Each builder (e.g. @vercel/python) may emit a `package-manifest.json`
 * in its diagnostics output.
 */
export declare const packageManifestSchema: {
    readonly type: "object";
    readonly required: readonly ["runtime", "dependencies"];
    readonly additionalProperties: false;
    readonly properties: {
        readonly version: {
            readonly type: "string";
            readonly description: "Manifest schema version, e.g. \"20260304\".";
        };
        readonly runtime: {
            readonly type: "string";
            readonly description: "Runtime identifier, e.g. \"python\", \"node\".";
        };
        readonly runtimeVersion: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["resolved"];
            readonly properties: {
                readonly requested: {
                    readonly type: "string";
                    readonly description: "Version constraint from the project manifest, e.g. \">=3.10\".";
                };
                readonly requestedSource: {
                    readonly type: "string";
                    readonly description: "File that declared the constraint, e.g. \"pyproject.toml\".";
                };
                readonly resolved: {
                    readonly type: "string";
                    readonly description: "Actual resolved version, e.g. \"3.12\".";
                };
            };
        };
        readonly dependencies: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["name", "type", "scopes", "resolved"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly name: {
                        readonly type: "string";
                    };
                    readonly type: {
                        readonly type: "string";
                        readonly enum: readonly ["direct", "transitive", "peer"];
                    };
                    readonly scopes: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "Dependency groups this package belongs to, e.g. [\"main\", \"dev\"].";
                    };
                    readonly requested: {
                        readonly type: "string";
                        readonly description: "Version specifier as declared, e.g. \"flask>=2.0\".";
                    };
                    readonly resolved: {
                        readonly type: "string";
                        readonly description: "Resolved version, e.g. \"3.1.0\".";
                    };
                    readonly source: {
                        readonly type: "string";
                        readonly description: "Package source type, e.g. \"registry\", \"git\", \"path\".";
                    };
                    readonly sourceUrl: {
                        readonly type: "string";
                        readonly description: "Source URL, e.g. \"https://pypi.org\".";
                    };
                };
            };
        };
    };
};
