"use strict";
// This file can also be imported as `@vercel/sandbox/dist/auth`, which is completely fine.
// The only valid importer of this would be the CLI as we share the same codebase.
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectTeam = exports.inferScope = exports.pollForToken = void 0;
__exportStar(require("./file"), exports);
__exportStar(require("./oauth"), exports);
var poll_for_token_1 = require("./poll-for-token");
Object.defineProperty(exports, "pollForToken", { enumerable: true, get: function () { return poll_for_token_1.pollForToken; } });
var project_1 = require("./project");
Object.defineProperty(exports, "inferScope", { enumerable: true, get: function () { return project_1.inferScope; } });
Object.defineProperty(exports, "selectTeam", { enumerable: true, get: function () { return project_1.selectTeam; } });
//# sourceMappingURL=index.js.map