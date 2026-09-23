import { SESSION_LOG_EVENT, SESSION_LOG_SCHEMA_VERSION } from '../session-log-events.js';
import { checkContainerIntegrity, isPlainRecord, json } from './field-decoders.js';
import { PAYLOADS } from './payload-shapes.js';
import { atKey, describeValue } from '../session-record-codec/decode-outcome.js';
import { decodeString, decodeTimestampString } from '../session-record-codec/scalars.js';

import type { TSessionLogEventName } from '../session-log-events.js';
import type { ISessionLogEntry } from '../session-log-replay.js';
import type { TPayloadShape } from './field-decoders.js';
import type { TDecodeIssues } from '../session-record-codec/decode-outcome.js';
import type { TUniversalMessage, TUniversalValue } from '@robota-sdk/agent-core';
import type { ISessionRecordDecodeIssue } from '@robota-sdk/agent-interface-session';

export { SESSION_LOG_SCHEMA_VERSION } from '../session-log-events.js';

export type TSessionLogDecodeErrorCode = 'INVALID_JSON' | 'INVALID_EVENT' | 'UNSUPPORTED_VERSION';

type TDecodedEvent<TName extends TSessionLogEventName> = ISessionLogEntry & { event: TName };
export type TDecodedSessionLogEntry =
  | (TDecodedEvent<'provider_response_normalized'> & { response: TUniversalMessage })
  | (TDecodedEvent<'history_mutation'> & { mutation: 'append_message'; message: TUniversalMessage })
  | (TDecodedEvent<'assistant_message_committed'> & { message: TUniversalMessage | string })
  | (TDecodedEvent<'tool_message_committed'> & { message: TUniversalMessage })
  | (TDecodedEvent<'background_task_event'> & { backgroundEvent?: object; data?: object })
  | (TDecodedEvent<'background_job_group_event'> & {
      backgroundJobGroupEvent?: object;
      data?: object;
    })
  | (TDecodedEvent<'memory_event'> & { memoryEvent?: object; data?: object })
  | TDecodedEvent<
      Exclude<
        TSessionLogEventName,
        | 'provider_response_normalized'
        | 'history_mutation'
        | 'assistant_message_committed'
        | 'tool_message_committed'
        | 'background_task_event'
        | 'background_job_group_event'
        | 'memory_event'
      >
    >;

export class SessionLogDecodeError extends Error {
  readonly code: TSessionLogDecodeErrorCode;
  readonly issues: readonly ISessionRecordDecodeIssue[];
  readonly schemaVersion?: number;

  constructor(
    code: TSessionLogDecodeErrorCode,
    issues: readonly ISessionRecordDecodeIssue[],
    options: { schemaVersion?: number; cause?: unknown } = {},
  ) {
    super(
      `Session log decode failed: ${code}${issues[0] ? ` at ${issues[0].path}: ${issues[0].message}` : ''}`,
      { cause: options.cause },
    );
    this.name = 'SessionLogDecodeError';
    this.code = code;
    this.issues = issues;
    if (options.schemaVersion !== undefined) this.schemaVersion = options.schemaVersion;
  }
}

interface IEntryDecodeResult {
  entry?: TDecodedSessionLogEntry;
  unsupported?: number;
}

interface IEnvelopeDecodeResult {
  output: Record<string, TUniversalValue>;
  event?: TSessionLogEventName;
  unsupported?: number;
}

const EVENTS = new Set<string>(Object.values(SESSION_LOG_EVENT));

/** Validate the full input before returning any entry to replay consumers. */
export function decodeSessionLogEntries(
  entries: unknown,
  options: { lineNumbers?: readonly number[] } = {},
): TDecodedSessionLogEntry[] {
  if (!Array.isArray(entries))
    throw new SessionLogDecodeError('INVALID_EVENT', [
      { path: 'entries', message: `expected an array, received ${describeValue(entries)}` },
    ]);
  const issues: TDecodeIssues = [];
  const decoded: TDecodedSessionLogEntry[] = [];
  let unsupported: number | undefined;
  for (const [index, value] of entries.entries()) {
    const path =
      options.lineNumbers?.[index] === undefined
        ? `[${index}]`
        : `line ${options.lineNumbers[index]}`;
    const result = decodeEntry(value, path, issues);
    if (result.entry !== undefined) decoded.push(result.entry);
    unsupported ??= result.unsupported;
  }
  if (issues.length > 0)
    throw new SessionLogDecodeError(
      unsupported === undefined ? 'INVALID_EVENT' : 'UNSUPPORTED_VERSION',
      issues,
      { schemaVersion: unsupported },
    );
  return decoded;
}

function decodeEntry(value: unknown, path: string, issues: TDecodeIssues): IEntryDecodeResult {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: `expected an object, received ${describeValue(value)}` });
    return {};
  }
  const issuesBeforeIntegrity = issues.length;
  checkContainerIntegrity(value, path, issues);
  // Recursive record decoders may not carry a cycle guard. Never enter them after this preflight fails.
  if (issues.length !== issuesBeforeIntegrity) return {};
  const envelope = decodeEnvelope(value, path, issues);
  if (envelope.event === undefined) return { unsupported: envelope.unsupported };
  decodePayload(value, envelope.event, path, envelope.output, issues);
  return { entry: envelope.output as TDecodedSessionLogEntry, unsupported: envelope.unsupported };
}

function decodeEnvelope(
  raw: Record<string, unknown>,
  path: string,
  issues: TDecodeIssues,
): IEnvelopeDecodeResult {
  const output: Record<string, TUniversalValue> = { schemaVersion: SESSION_LOG_SCHEMA_VERSION };
  let unsupported: number | undefined;
  if (raw['schemaVersion'] !== SESSION_LOG_SCHEMA_VERSION) {
    const version = raw['schemaVersion'];
    if (typeof version === 'number' && Number.isSafeInteger(version) && version >= 0) {
      unsupported = version;
      issues.push({ path: atKey(path, 'schemaVersion'), message: 'unsupported schema version' });
    } else {
      issues.push({
        path: atKey(path, 'schemaVersion'),
        message: `expected schema version 1, received ${describeValue(version)}`,
      });
    }
  }
  const timestamp = decodeTimestampString(raw['timestamp'], atKey(path, 'timestamp'), issues);
  if (timestamp !== undefined) output['timestamp'] = timestamp;
  const sessionId = decodeString(raw['sessionId'], atKey(path, 'sessionId'), issues);
  if (sessionId === '')
    issues.push({ path: atKey(path, 'sessionId'), message: 'expected a non-empty session ID' });
  if (sessionId !== undefined) output['sessionId'] = sessionId;
  const event = raw['event'];
  if (typeof event !== 'string' || !EVENTS.has(event)) {
    issues.push({
      path: atKey(path, 'event'),
      message: `expected a declared event name, received ${describeValue(event)}`,
    });
    return { output, unsupported };
  }
  output['event'] = event;
  return { output, event: event as TSessionLogEventName, unsupported };
}

function decodePayload(
  raw: Record<string, unknown>,
  event: TSessionLogEventName,
  path: string,
  output: Record<string, TUniversalValue>,
  issues: TDecodeIssues,
): void {
  const shape: TPayloadShape = PAYLOADS[event];
  for (const [key, field] of Object.entries(shape)) {
    if (!Object.hasOwn(raw, key) && field.optional) continue;
    const member = field.decode(raw[key], atKey(path, key), issues);
    if (member !== undefined) output[key] = member as TUniversalValue;
  }
  for (const key of Object.keys(raw)) {
    if (['schemaVersion', 'timestamp', 'sessionId', 'event', ...Object.keys(shape)].includes(key))
      continue;
    if (event !== 'server_tool') {
      issues.push({ path: atKey(path, key), message: 'unknown event payload field' });
      continue;
    }
    const member = json(raw[key], atKey(path, key), issues);
    if (member !== undefined) output[key] = member;
  }
  requireAuxiliaryPayload(raw, event, path, issues);
}

function requireAuxiliaryPayload(
  raw: Record<string, unknown>,
  event: TSessionLogEventName,
  path: string,
  issues: TDecodeIssues,
): void {
  if (
    event === 'background_task_event' &&
    raw['backgroundEvent'] === undefined &&
    raw['data'] === undefined
  )
    issues.push({ path, message: 'expected a background task event payload' });
  if (
    event === 'background_job_group_event' &&
    raw['backgroundJobGroupEvent'] === undefined &&
    raw['data'] === undefined
  )
    issues.push({ path, message: 'expected a background job group event payload' });
  if (event === 'memory_event' && raw['memoryEvent'] === undefined && raw['data'] === undefined)
    issues.push({ path, message: 'expected a memory event payload' });
}
