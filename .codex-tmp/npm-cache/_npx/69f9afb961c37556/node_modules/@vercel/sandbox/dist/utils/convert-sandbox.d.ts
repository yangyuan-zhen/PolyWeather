import type { SandboxMetaData } from "../api-client";
import type { NetworkPolicy } from "../network-policy";
export type ConvertedSandbox = Omit<SandboxMetaData, "networkPolicy"> & {
    networkPolicy?: NetworkPolicy;
};
export declare function convertSandbox(sandbox: SandboxMetaData): ConvertedSandbox;
