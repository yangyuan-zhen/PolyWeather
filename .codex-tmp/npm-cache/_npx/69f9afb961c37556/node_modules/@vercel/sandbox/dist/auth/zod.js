"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.json = void 0;
const zod_1 = require("zod");
/**
 * A Zod codec that serializes and deserializes JSON strings.
 */
exports.json = zod_1.z.string().transform((jsonString, ctx) => {
    try {
        return JSON.parse(jsonString);
    }
    catch (err) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `Invalid JSON: ${err.message}`,
        });
        return zod_1.z.NEVER;
    }
});
//# sourceMappingURL=zod.js.map