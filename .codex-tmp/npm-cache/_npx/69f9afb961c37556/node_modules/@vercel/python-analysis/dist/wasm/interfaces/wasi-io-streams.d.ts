/** @module Interface wasi:io/streams@0.2.6 **/
export type Error = import('./wasi-io-error.js').Error;
export type StreamError = StreamErrorLastOperationFailed | StreamErrorClosed;
export interface StreamErrorLastOperationFailed {
  tag: 'last-operation-failed',
  val: Error,
}
export interface StreamErrorClosed {
  tag: 'closed',
}
export type Pollable = import('./wasi-io-poll.js').Pollable;

export class InputStream {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
}

export class OutputStream {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  checkWrite(): bigint;
  write(contents: Uint8Array): void;
  blockingFlush(): void;
  subscribe(): Pollable;
}
