/**
 * Session log payload normalization — scrubbing and size-bounding what goes into a log line.
 *
 * Split out of `session-logger.ts` to keep each file under 300 lines. The split is by
 * responsibility, not by size alone: this module decides WHAT a line may contain (sensitive keys
 * redacted, oversized payloads written beside the log and referenced), while `session-logger.ts`
 * decides WHERE and WHEN the bytes are written.
 */

import { createHash } from 'node:crypto';

import { isSensitiveKey } from './scrub-sensitive.js';

import type { IExternalPayloadSink } from './session-log-sinks.js';
import type {
  IFileSessionLoggerOptions,
  TSessionLogData,
  TSessionLogValue,
} from './session-logger.js';

export function normalizeLogData(
  sessionId: string,
  data: TSessionLogData,
  options: Required<IFileSessionLoggerOptions>,
  externalPayloadSink: IExternalPayloadSink | undefined,
): TSessionLogData {
  const normalized: TSessionLogData = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = normalizeLogValue(sessionId, key, value, options, externalPayloadSink);
  }
  return normalized;
}

function normalizeLogValue(
  sessionId: string,
  key: string,
  value: TSessionLogValue,
  options: Required<IFileSessionLoggerOptions>,
  externalPayloadSink: IExternalPayloadSink | undefined,
): TSessionLogValue {
  if (isSensitiveKey(key)) {
    return options.redactedValue;
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return maybeExternalizePayload(sessionId, value, options, externalPayloadSink);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const normalizedArray = value.map((item) =>
      normalizeLogValue(sessionId, key, item as TSessionLogValue, options, externalPayloadSink),
    );
    return maybeExternalizePayload(sessionId, normalizedArray, options, externalPayloadSink);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, TSessionLogValue>;
    const normalizedRecord: Record<string, TSessionLogValue> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      normalizedRecord[childKey] = normalizeLogValue(
        sessionId,
        childKey,
        childValue,
        options,
        externalPayloadSink,
      );
    }
    return maybeExternalizePayload(sessionId, normalizedRecord, options, externalPayloadSink);
  }
  return String(value);
}

function maybeExternalizePayload(
  sessionId: string,
  value: TSessionLogValue,
  options: Required<IFileSessionLoggerOptions>,
  externalPayloadSink: IExternalPayloadSink | undefined,
): TSessionLogValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  const byteLength = Buffer.byteLength(serialized);
  if (byteLength <= options.externalPayloadThresholdBytes || externalPayloadSink === undefined) {
    return value;
  }

  const sha256 = createHash('sha256').update(serialized).digest('hex');
  return externalPayloadSink.writeJson(sessionId, sha256, serialized);
}

/** No-op logger — used when logging is disabled. */
