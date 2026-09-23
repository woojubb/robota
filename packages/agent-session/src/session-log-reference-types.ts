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

export interface IFileSessionLoggerOptions {
  externalPayloadThresholdBytes?: number;
  redactedValue?: string;
}
