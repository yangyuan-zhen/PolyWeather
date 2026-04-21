"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchApi = fetchApi;
const error_1 = require("./error");
async function fetchApi(opts) {
    const x = await fetch(`https://api.vercel.com${opts.endpoint}`, {
        method: opts.method,
        body: opts.body,
        headers: {
            Authorization: `Bearer ${opts.token}`,
            "Content-Type": "application/json",
        },
    });
    if (!x.ok) {
        let message = await x.text();
        try {
            const { error } = JSON.parse(message);
            message = `${error.code.toUpperCase()}: ${error.message}`;
        }
        catch { }
        throw new error_1.NotOk({
            responseText: message,
            statusCode: x.status,
        });
    }
    return (await x.json());
}
//# sourceMappingURL=api.js.map