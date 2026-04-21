"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAPINetworkPolicy = toAPINetworkPolicy;
exports.fromAPINetworkPolicy = fromAPINetworkPolicy;
function toAPINetworkPolicy(policy) {
    if (policy === "allow-all")
        return { mode: "allow-all" };
    if (policy === "deny-all")
        return { mode: "deny-all" };
    if (policy.allow && !Array.isArray(policy.allow)) {
        const allowedDomains = Object.keys(policy.allow);
        const injectionRules = [];
        for (const [domain, rules] of Object.entries(policy.allow)) {
            const merged = {};
            for (const rule of rules) {
                for (const t of rule.transform ?? []) {
                    Object.assign(merged, t.headers);
                }
            }
            if (Object.keys(merged).length > 0) {
                injectionRules.push({ domain, headers: merged });
            }
        }
        return {
            mode: "custom",
            ...(allowedDomains.length > 0 && { allowedDomains }),
            ...(injectionRules.length > 0 && { injectionRules }),
            ...(policy.subnets?.allow && { allowedCIDRs: policy.subnets.allow }),
            ...(policy.subnets?.deny && { deniedCIDRs: policy.subnets.deny }),
        };
    }
    return {
        mode: "custom",
        ...(policy.allow && { allowedDomains: policy.allow }),
        ...(policy.subnets?.allow && { allowedCIDRs: policy.subnets.allow }),
        ...(policy.subnets?.deny && { deniedCIDRs: policy.subnets.deny }),
    };
}
function fromAPINetworkPolicy(api) {
    if (api.mode === "allow-all")
        return "allow-all";
    if (api.mode === "deny-all")
        return "deny-all";
    const subnets = (api.allowedCIDRs || api.deniedCIDRs)
        ? {
            subnets: {
                ...(api.allowedCIDRs && { allow: api.allowedCIDRs }),
                ...(api.deniedCIDRs && { deny: api.deniedCIDRs }),
            },
        }
        : undefined;
    // If injectionRules are present, reconstruct the record form.
    // The API returns headerNames (secret values are stripped), so we
    // populate each header value with "<redacted>".
    if (api.injectionRules && api.injectionRules.length > 0) {
        const rulesByDomain = new Map(api.injectionRules.map((r) => [r.domain, r.headerNames ?? []]));
        const allow = {};
        for (const domain of api.allowedDomains ?? []) {
            const headerNames = rulesByDomain.get(domain);
            if (headerNames && headerNames.length > 0) {
                const headers = Object.fromEntries(headerNames.map((n) => [n, "<redacted>"]));
                allow[domain] = [{ transform: [{ headers }] }];
            }
            else {
                allow[domain] = [];
            }
        }
        // Include injection rules for domains not in allowedDomains
        for (const rule of api.injectionRules) {
            if (!(rule.domain in allow)) {
                const headers = Object.fromEntries((rule.headerNames ?? []).map((n) => [n, "<redacted>"]));
                allow[rule.domain] = [{ transform: [{ headers }] }];
            }
        }
        return { allow, ...subnets };
    }
    return {
        ...(api.allowedDomains && { allow: api.allowedDomains }),
        ...subnets,
    };
}
//# sourceMappingURL=network-policy.js.map