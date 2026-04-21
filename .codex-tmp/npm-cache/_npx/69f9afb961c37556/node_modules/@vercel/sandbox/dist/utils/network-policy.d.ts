import { z } from "zod";
import { NetworkPolicy } from "../network-policy";
import { NetworkPolicyValidator } from "../api-client/validators";
type APINetworkPolicy = z.infer<typeof NetworkPolicyValidator>;
export declare function toAPINetworkPolicy(policy: NetworkPolicy): APINetworkPolicy;
export declare function fromAPINetworkPolicy(api: APINetworkPolicy): NetworkPolicy;
export {};
