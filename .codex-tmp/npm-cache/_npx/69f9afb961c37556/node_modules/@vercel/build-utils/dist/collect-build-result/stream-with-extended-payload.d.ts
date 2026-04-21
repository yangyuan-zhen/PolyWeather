/// <reference types="node" />
export interface ExtendedBodyData {
    prefix: string;
    suffix: string;
}
export declare function streamWithExtendedPayload(stream: NodeJS.ReadableStream, data?: ExtendedBodyData): NodeJS.ReadableStream;
