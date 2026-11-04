/**
 * Leaf type module for {@link IExternalPayloadReference}.
 *
 * Split out of `session-logger.ts` so `session-log-sinks.ts` and `session-log-payload.ts` can
 * depend on this type without importing back from `session-logger.ts`, which previously created
 * import cycles among the three files.
 */
export interface IExternalPayloadReference {
  kind: 'external-payload';
  encoding: 'json';
  sha256: string;
  byteLength: number;
  relativePath: string;
}

/** Session log event data — extensible record of event metadata. */
export type TSessionLogValue = string | number | boolean | object | null | undefined;
export type TSessionLogData = Record<string, TSessionLogValue>;

/**
 * Hands a host the function that writes out everything still buffered, to run when the process is
 * about to end (see `registerProcessExitFlush` in `@robota-sdk/agent-session/node`).
 */
export type TRegisterExitFlush = (flush: () => void) => void;

export interface IFileSessionLoggerOptions {
  externalPayloadThresholdBytes?: number;
  redactedValue?: string;
  /**
   * Called once per distinct function (not once per logger) with a function that flushes every live
   * logger, so a stream's buffered tail still reaches the log when the process exits mid-stream.
   * Pass the same function to every logger. Absent, nothing is flushed on exit: the log then misses
   * the unflushed tail of an abnormal exit.
   */
  registerExitFlush?: TRegisterExitFlush;
}
