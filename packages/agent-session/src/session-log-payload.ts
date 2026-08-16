/**
 * Session log payload normalization — scrubbing and size-bounding what goes into a log line.
 *
 * Split out of `session-logger.ts` to keep each file under 300 lines. The split is by
 * responsibility, not by size alone: this module decides WHAT a line may contain (sensitive keys
 * redacted, oversized payloads written beside the log and referenced), while `session-logger.ts`
 * decides WHERE and WHEN the bytes are written.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isSensitiveKey } from './scrub-sensitive.js';

import type {
  IExternalPayloadReference,
  IFileSessionLoggerOptions,
  TSessionLogData,
  TSessionLogValue,
} from './session-logger.js';

/**
 * Session logs and externalized payloads carry conversation content, so they are created
 * owner-only rather than inheriting the process umask (SEC-003 / CWE-377).
 */
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;

export function normalizeLogData(
  sessionId: string,
  logDir: string,
  data: TSessionLogData,
  options: Required<IFileSessionLoggerOptions>,
): TSessionLogData {
  const normalized: TSessionLogData = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = normalizeLogValue(sessionId, logDir, key, value, options);
  }
  return normalized;
}

function normalizeLogValue(
  sessionId: string,
  logDir: string,
  key: string,
  value: TSessionLogValue,
  options: Required<IFileSessionLoggerOptions>,
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
    return maybeExternalizePayload(sessionId, logDir, value, options);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const normalizedArray = value.map((item) =>
      normalizeLogValue(sessionId, logDir, key, item as TSessionLogValue, options),
    );
    return maybeExternalizePayload(sessionId, logDir, normalizedArray, options);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, TSessionLogValue>;
    const normalizedRecord: Record<string, TSessionLogValue> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      normalizedRecord[childKey] = normalizeLogValue(
        sessionId,
        logDir,
        childKey,
        childValue,
        options,
      );
    }
    return maybeExternalizePayload(sessionId, logDir, normalizedRecord, options);
  }
  return String(value);
}

function maybeExternalizePayload(
  sessionId: string,
  logDir: string,
  value: TSessionLogValue,
  options: Required<IFileSessionLoggerOptions>,
): TSessionLogValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  const byteLength = Buffer.byteLength(serialized);
  if (byteLength <= options.externalPayloadThresholdBytes) {
    return value;
  }

  const sha256 = createHash('sha256').update(serialized).digest('hex');
  const payloadDirName = `${sessionId}.payloads`;
  const payloadFileName = `${sha256}.json`;
  const relativePath = join(payloadDirName, payloadFileName);
  const payloadDir = join(logDir, payloadDirName);
  const payloadPath = join(logDir, relativePath);
  mkdirSync(payloadDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  // The payload is content-addressed by its own sha256, so an existing file necessarily holds
  // identical bytes. Create it exclusively ('wx') rather than testing existsSync first: the
  // check-then-write pair is a TOCTOU race between concurrent sessions writing the same payload.
  try {
    writeFileSync(payloadPath, serialized, {
      encoding: 'utf-8',
      mode: OWNER_ONLY_FILE_MODE,
      flag: 'wx',
    });
  } catch {
    // allow-fallback: EEXIST means the identical content-addressed payload is already on disk
  }
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256,
    byteLength,
    relativePath,
  } satisfies IExternalPayloadReference;
}

/** No-op logger — used when logging is disabled. */
