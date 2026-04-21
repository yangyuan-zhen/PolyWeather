"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var schemas_exports = {};
__export(schemas_exports, {
  buildsSchema: () => buildsSchema,
  functionsSchema: () => functionsSchema,
  packageManifestSchema: () => packageManifestSchema
});
module.exports = __toCommonJS(schemas_exports);
const triggerEventSchemaV1 = {
  type: "object",
  properties: {
    type: {
      type: "string",
      const: "queue/v1beta"
    },
    topic: {
      type: "string",
      minLength: 1
    },
    consumer: {
      type: "string",
      minLength: 1
    },
    maxDeliveries: {
      type: "number",
      minimum: 1
    },
    retryAfterSeconds: {
      type: "number",
      exclusiveMinimum: 0
    },
    initialDelaySeconds: {
      type: "number",
      minimum: 0
    },
    maxConcurrency: {
      type: "number",
      minimum: 1
    }
  },
  required: ["type", "topic", "consumer"],
  additionalProperties: false
};
const triggerEventSchemaV2 = {
  type: "object",
  properties: {
    type: {
      type: "string",
      const: "queue/v2beta"
    },
    topic: {
      type: "string",
      minLength: 1
    },
    maxDeliveries: {
      type: "number",
      minimum: 1
    },
    retryAfterSeconds: {
      type: "number",
      exclusiveMinimum: 0
    },
    initialDelaySeconds: {
      type: "number",
      minimum: 0
    },
    maxConcurrency: {
      type: "number",
      minimum: 1
    }
  },
  required: ["type", "topic"],
  additionalProperties: false
};
const triggerEventSchema = {
  oneOf: [triggerEventSchemaV1, triggerEventSchemaV2]
};
const functionsSchema = {
  type: "object",
  minProperties: 1,
  maxProperties: 50,
  additionalProperties: false,
  patternProperties: {
    "^.{1,256}$": {
      type: "object",
      additionalProperties: false,
      properties: {
        architecture: {
          type: "string",
          enum: ["x86_64", "arm64"]
        },
        runtime: {
          type: "string",
          maxLength: 256
        },
        memory: {
          minimum: 128,
          maximum: 10240
        },
        maxDuration: {
          oneOf: [
            { type: "integer", minimum: 1, maximum: 900 },
            { type: "string", enum: ["max"] }
          ]
        },
        regions: {
          type: "array",
          items: {
            type: "string"
          }
        },
        functionFailoverRegions: {
          type: "array",
          items: {
            type: "string"
          }
        },
        includeFiles: {
          type: "string",
          maxLength: 256
        },
        excludeFiles: {
          type: "string",
          maxLength: 256
        },
        experimentalTriggers: {
          type: "array",
          items: triggerEventSchema
        },
        supportsCancellation: {
          type: "boolean"
        }
      }
    }
  }
};
const buildsSchema = {
  type: "array",
  minItems: 0,
  maxItems: 128,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["use"],
    properties: {
      src: {
        type: "string",
        minLength: 1,
        maxLength: 4096
      },
      use: {
        type: "string",
        minLength: 3,
        maxLength: 256
      },
      config: { type: "object" }
    }
  }
};
const packageManifestSchema = {
  type: "object",
  required: ["runtime", "dependencies"],
  additionalProperties: false,
  properties: {
    version: {
      type: "string",
      description: 'Manifest schema version, e.g. "20260304".'
    },
    runtime: {
      type: "string",
      description: 'Runtime identifier, e.g. "python", "node".'
    },
    runtimeVersion: {
      type: "object",
      additionalProperties: false,
      required: ["resolved"],
      properties: {
        requested: {
          type: "string",
          description: 'Version constraint from the project manifest, e.g. ">=3.10".'
        },
        requestedSource: {
          type: "string",
          description: 'File that declared the constraint, e.g. "pyproject.toml".'
        },
        resolved: {
          type: "string",
          description: 'Actual resolved version, e.g. "3.12".'
        }
      }
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "scopes", "resolved"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["direct", "transitive", "peer"] },
          scopes: {
            type: "array",
            items: { type: "string" },
            description: 'Dependency groups this package belongs to, e.g. ["main", "dev"].'
          },
          requested: {
            type: "string",
            description: 'Version specifier as declared, e.g. "flask>=2.0".'
          },
          resolved: {
            type: "string",
            description: 'Resolved version, e.g. "3.1.0".'
          },
          source: {
            type: "string",
            description: 'Package source type, e.g. "registry", "git", "path".'
          },
          sourceUrl: {
            type: "string",
            description: 'Source URL, e.g. "https://pypi.org".'
          }
        }
      }
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildsSchema,
  functionsSchema,
  packageManifestSchema
});
