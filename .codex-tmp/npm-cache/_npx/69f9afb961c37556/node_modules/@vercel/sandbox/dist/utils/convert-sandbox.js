"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertSandbox = convertSandbox;
const network_policy_1 = require("./network-policy");
function convertSandbox(sandbox) {
    const { networkPolicy, ...rest } = sandbox;
    return {
        ...rest,
        networkPolicy: networkPolicy
            ? (0, network_policy_1.fromAPINetworkPolicy)(networkPolicy)
            : undefined,
    };
}
//# sourceMappingURL=convert-sandbox.js.map