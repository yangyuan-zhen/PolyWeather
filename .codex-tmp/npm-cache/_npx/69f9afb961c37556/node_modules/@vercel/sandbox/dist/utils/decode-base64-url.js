"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeBase64Url = decodeBase64Url;
/**
 * Decode a Base64 URL-encoded string into a JSON object.
 *
 * @param base64Url - The Base64 URL-encoded string to decode.
 * @returns The decoded JSON object or null if decoding fails.
 */
function decodeBase64Url(base64Url) {
    return JSON.parse(Buffer.from(base64Url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}
//# sourceMappingURL=decode-base64-url.js.map