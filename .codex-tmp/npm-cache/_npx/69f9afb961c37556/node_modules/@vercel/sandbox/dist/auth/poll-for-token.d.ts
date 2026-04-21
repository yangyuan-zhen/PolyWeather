import { DeviceAuthorizationRequest, OAuth } from "./oauth";
export type PollTokenItem = {
    _tag: "Timeout";
    newInterval: number;
} | {
    _tag: "SlowDown";
    newInterval: number;
} | {
    _tag: "Error";
    error: Error;
} | {
    _tag: "Response";
    response: {
        text(): Promise<string>;
    };
};
export declare function pollForToken({ request, oauth, }: {
    request: DeviceAuthorizationRequest;
    oauth: OAuth;
}): AsyncGenerator<PollTokenItem, void, void>;
