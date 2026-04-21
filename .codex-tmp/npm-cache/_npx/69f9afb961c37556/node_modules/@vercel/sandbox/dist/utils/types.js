"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrivateParams = void 0;
/**
 * Extract private parameters out of an object.
 */
const getPrivateParams = (params) => {
    const privateEntries = Object.entries(params ?? {}).filter(([k]) => k.startsWith("__"));
    return Object.fromEntries(privateEntries);
};
exports.getPrivateParams = getPrivateParams;
//# sourceMappingURL=types.js.map