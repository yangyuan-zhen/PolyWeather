/**
 * A transform applied to network requests matching a domain rule.
 *
 * @example
 * {
 *   headers: { authorization: "Bearer sk-..." }
 * }
 */
export type NetworkTransformer = {
    /** Headers to set on the outgoing request. */
    headers?: Record<string, string>;
};
/**
 * A rule applied to requests matching a domain in the network policy.
 */
export type NetworkPolicyRule = {
    /** Transforms to apply to matching requests. */
    transform?: NetworkTransformer[];
};
/**
 * Network policy to define network restrictions for the sandbox.
 *
 * - `"allow-all"`: Full internet access (default). All traffic is allowed.
 * - `"deny-all"`: No internet access. All traffic is denied.
 * - Object: Custom access with explicit allow/deny lists.
 *
 * @example
 * // Full internet access (default)
 * "allow-all"
 *
 * @example
 * // No external access
 * "deny-all"
 *
 * @example
 * // Custom access with specific domains (simple list)
 * // All traffic not explicitly allowed is denied.
 * {
 *   allow: ["*.npmjs.org", "github.com"],
 *   subnets: {
 *     allow: ["10.0.0.0/8"],
 *     deny: ["10.1.0.0/16"]
 *   }
 * }
 *
 * @example
 * // Custom access with specific domains (record form)
 * {
 *   allow: {
 *     "*.npmjs.org": [],
 *     "github.com": [],
 *   }
 * }
 *
 * @example
 * // Custom access with request transformers
 * {
 *   allow: {
 *     "ai-gateway.vercel.sh": [
 *       {
 *         transform: [{
 *           headers: { authorization: "Bearer ..." }
 *         }]
 *       }
 *     ],
 *     "*": []
 *   }
 * }
 */
export type NetworkPolicy = "allow-all" | "deny-all" | {
    /**
     * Domains to allow traffic to.
     * Use "*" prefix for wildcard matching (e.g., "*.npmjs.org").
     *
     * Accepts either:
     * - `string[]`: A simple list of domains to allow.
     * - `Record<string, NetworkPolicyRule[]>`: A map of domains to rules.
     *   An empty array allows traffic with no additional rules.
     */
    allow?: string[] | Record<string, NetworkPolicyRule[]>;
    /**
     * Subnet-level access control using CIDR notation.
     */
    subnets?: {
        /**
         * List of CIDRs to allow traffic to.
         * Traffic to these addresses will bypass the domain allowlist.
         */
        allow?: string[];
        /**
         * List of CIDRs to deny traffic to.
         * These take precedence over allowed domains and CIDRs.
         */
        deny?: string[];
    };
};
