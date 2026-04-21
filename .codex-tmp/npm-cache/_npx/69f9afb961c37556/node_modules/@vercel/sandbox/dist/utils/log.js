"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.write = write;
exports.code = code;
const picocolors_1 = __importDefault(require("picocolors"));
const colors = {
    warn: picocolors_1.default.yellow,
    error: picocolors_1.default.red,
    success: picocolors_1.default.green,
    info: picocolors_1.default.blue,
};
const logPrefix = picocolors_1.default.dim("[vercel/sandbox]");
function write(level, text) {
    text = Array.isArray(text) ? text.join("\n") : text;
    const prefixed = text.replace(/^/gm, `${logPrefix} `);
    console.error(colors[level](prefixed));
}
function code(text) {
    return picocolors_1.default.italic(picocolors_1.default.dim("`") + text + picocolors_1.default.dim("`"));
}
//# sourceMappingURL=log.js.map