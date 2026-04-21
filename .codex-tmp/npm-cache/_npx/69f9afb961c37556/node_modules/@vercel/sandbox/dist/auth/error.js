"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotOk = void 0;
class NotOk extends Error {
    constructor(response) {
        super(`HTTP ${response.statusCode}: ${response.responseText}`);
        this.name = "NotOk";
        this.response = response;
    }
}
exports.NotOk = NotOk;
//# sourceMappingURL=error.js.map