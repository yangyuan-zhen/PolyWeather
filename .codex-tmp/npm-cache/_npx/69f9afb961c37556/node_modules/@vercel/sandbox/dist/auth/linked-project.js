"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLinkedProject = readLinkedProject;
const zod_1 = require("zod");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const zod_2 = require("./zod");
const LinkedProjectSchema = zod_2.json.pipe(zod_1.z.object({
    projectId: zod_1.z.string(),
    orgId: zod_1.z.string(),
}));
/**
 * Reads the linked project configuration from `.vercel/project.json`.
 *
 * @param cwd - The directory to search for `.vercel/project.json`.
 * @returns The linked project's `projectId` and `teamId`, or `null` if not found.
 */
async function readLinkedProject(cwd) {
    const projectJsonPath = path.join(cwd, ".vercel", "project.json");
    let content;
    try {
        content = await fs.readFile(projectJsonPath, "utf-8");
    }
    catch {
        return null;
    }
    const parsed = LinkedProjectSchema.safeParse(content);
    if (!parsed.success) {
        return null;
    }
    return {
        projectId: parsed.data.projectId,
        teamId: parsed.data.orgId,
    };
}
//# sourceMappingURL=linked-project.js.map