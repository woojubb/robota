/**
 * Session Logger — pluggable logging interface for session events.
 *
 * ISessionLogger defines the contract. FileSessionLogger is the default
 * implementation that writes JSONL to disk. Consumers can implement their
 * own (e.g., remote, database, silent) and inject via Session constructor.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Session log event data — extensible record of event metadata. */
export type TSessionLogValue = string | number | boolean | object | null | undefined;
export type TSessionLogData = Record<string, TSessionLogValue>;

export interface IExternalPayloadReference {
  kind: 'external-payload';
  encoding: 'json';
  sha256: string;
  byteLength: number;
  relativePath: string;
}

export interface IFileSessionLoggerOptions {
  externalPayloadThresholdBytes?: number;
  redactedValue?: string;
}

const BYTES_PER_KIB = 1024;
const DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_KIB = 32;
const DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_BYTES =
  DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_KIB * BYTES_PER_KIB;
const DEFAULT_REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /^(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|password|x[-_]?api[-_]?key)$/i;

/**
 * Session logger interface — injected into Session for pluggable logging.
 *
 * Implementations decide where and how to persist session events.
 * The Session class calls log() for every significant action.
 */
export interface ISessionLogger {
  /** Log a session event with structured data. */
  log(sessionId: string, event: string, data: TSessionLogData): void;
}

/**
 * File-based session logger — writes JSONL to {logDir}/{sessionId}.jsonl.
 *
 * This is the default implementation used by the CLI.
 * Each line is a self-contained JSON object with timestamp, sessionId, event, and data.
 */
export class FileSessionLogger implements ISessionLogger {
  private readonly logDir: string;
  private readonly options: Required<IFileSessionLoggerOptions>;

  constructor(logDir: string, options: IFileSessionLoggerOptions = {}) {
    this.logDir = logDir;
    this.options = {
      externalPayloadThresholdBytes:
        options.externalPayloadThresholdBytes ?? DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_BYTES,
      redactedValue: options.redactedValue ?? DEFAULT_REDACTED_VALUE,
    };
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      // Best-effort: logging disabled if directory cannot be created
    }
  }

  log(sessionId: string, event: string, data: TSessionLogData): void {
    try {
      const normalizedData = normalizeLogData(sessionId, this.logDir, data, this.options);
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId,
        event,
        ...normalizedData,
      });
      const logFile = join(this.logDir, `${sessionId}.jsonl`);
      appendFileSync(logFile, entry + '\n');
    } catch {
      // Logging failure must never break the session
    }
  }
}

function normalizeLogData(
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
  if (SENSITIVE_KEY_PATTERN.test(key)) {
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
  mkdirSync(payloadDir, { recursive: true });
  if (!existsSync(payloadPath)) {
    writeFileSync(payloadPath, serialized, 'utf-8');
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
export class SilentSessionLogger implements ISessionLogger {
  log(): void {
    // intentionally empty
  }
}
