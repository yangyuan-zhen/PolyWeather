/**
 * Consumes a readable entirely concatenating all content in a single Buffer
 * @param readable A Readable stream
 */
export declare function consumeReadable(readable: NodeJS.ReadableStream): Promise<Buffer<ArrayBufferLike>>;
