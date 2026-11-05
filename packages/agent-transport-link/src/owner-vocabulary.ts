/**
 * The owner vocabulary on the wire: the JSON inside `owner` frames, with a strict decoder for each
 * direction.
 *
 * Owner frames are authenticated, so a malformed one is never an attack from outside the link; it is
 * a peer that is broken or not what it claims, and the link closes. So every message has exactly its
 * fields, every field its type, pattern and bound, and anything else decodes to nothing. Text a
 * person will read (a notice, a question, a refusal) carries no control or bidirectional-override
 * character, so it shows as it is in a terminal or a native dialog. Decoding builds fresh values,
 * so nothing shaped by the peer (a prototype key, an extra field) survives into the domain value.
 * Encoding checks its own output with the decoder, so an end never sends what the other must refuse.
 */
import { Buffer } from 'node:buffer';

import type { TOwnerSessionQuestion } from '@robota-sdk/agent-interface-session';
import type { ITrustRoot } from '@robota-sdk/agent-keyring';

import type {
  IOwnerControlRequest,
  IRuntimeCustodyState,
  TGrantOutcome,
  TOwnerControlResult,
  TOwnerControlValue,
  TRequestedLockReason,
} from './link-ports.js';

/** A request from a link's client. */
export type TOwnerRequest =
  | { readonly op: 'install-trust-root'; readonly requestId: string; readonly root: ITrustRoot }
  | { readonly op: 'lock'; readonly requestId: string; readonly reason: TRequestedLockReason }
  | { readonly op: 'question'; readonly requestId: string; readonly sessionId: string }
  | {
      readonly op: 'open-accepted';
      readonly requestId: string;
      readonly bindingId: string;
      readonly sessionId: string;
      readonly acceptedDigest: string;
    }
  | { readonly op: 'control'; readonly requestId: string; readonly request: IOwnerControlRequest };

/** A reply or a notice from the runtime. */
export type TRuntimeMessage =
  | { readonly op: 'done'; readonly requestId: string }
  | { readonly op: 'unlocked'; readonly requestId: string; readonly sealingKey: TGrantOutcome }
  | {
      readonly op: 'question';
      readonly requestId: string;
      readonly question: TOwnerSessionQuestion;
    }
  | {
      readonly op: 'refused';
      readonly requestId: string;
      readonly code: string;
      readonly message: string;
    }
  | { readonly op: 'control'; readonly requestId: string; readonly result: TOwnerControlResult }
  | { readonly op: 'custody'; readonly state: IRuntimeCustodyState };

/** A client's own requests count `r1`, `r2`, ...; its read grants count `g1`, `g2`, ... */
export const REQUEST_ID_PATTERN = /^r[1-9][0-9]{0,15}$/u;
export const GRANT_ID_PATTERN = /^g[1-9][0-9]{0,15}$/u;

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9._:+/=-]{1,256}$/u;
const COMMAND_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,31}$/u;
const REFUSAL_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
/* eslint-disable no-control-regex -- these patterns exist to find control characters */
const UNSAFE_TEXT =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_FIELD = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
/* eslint-enable no-control-regex */
const MAX_TEXT_LENGTH = 4096;
const MAX_REFUSAL_MESSAGE_LENGTH = 1024;
const MAX_FIELDS = 16;
const MAX_FIELD_VALUE_LENGTH = 4096;
const MAX_RESULT_DEPTH = 8;
const MAX_RESULT_NODES = 4096;
const MAX_RESULT_STRING_LENGTH = 65_536;
const MAX_RESULT_KEY_LENGTH = 256;
const ATTACH_PUBLIC_KEY_BYTES = 32;
const CERTIFICATE_BYTES = 64;
const LOCK_REASONS: ReadonlySet<string> = new Set<TRequestedLockReason>([
  'explicit',
  'screen-lock',
  'suspend',
]);
const GRANT_OUTCOMES: ReadonlySet<string> = new Set<TGrantOutcome>(['verified', 'mismatch']);

type TRecord = Readonly<Record<string, unknown>>;

const textDecoder = new TextDecoder('utf-8', { fatal: true });

function parse(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    return undefined;
  }
}

/** `value` as a plain record with exactly `keys`, or `undefined`. */
function exactly(value: unknown, keys: readonly string[]): TRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)))
    return undefined;
  return value as TRecord;
}

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === 'string' && pattern.test(value);

const isText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  !UNSAFE_TEXT.test(value);

function bytesFrom(value: unknown, length: number): Uint8Array | undefined {
  if (!matches(value, BASE64URL_PATTERN)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === length && decoded.toString('base64url') === value
    ? Uint8Array.from(decoded)
    : undefined;
}

function fieldsFrom(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS) return undefined;
  const fields: Record<string, string> = {};
  for (const [key, field] of entries) {
    if (
      !FIELD_KEY_PATTERN.test(key) ||
      typeof field !== 'string' ||
      field.length > MAX_FIELD_VALUE_LENGTH ||
      UNSAFE_FIELD.test(field)
    ) {
      return undefined;
    }
    fields[key] = field;
  }
  return fields;
}

/** A fresh copy of a JSON control result within its bounds, or `undefined`. */
function resultFrom(value: unknown): TOwnerControlResult | undefined {
  let nodes = 0;
  const copy = (node: unknown, depth: number): TOwnerControlValue | undefined => {
    nodes += 1;
    if (nodes > MAX_RESULT_NODES) return undefined;
    if (node === null || typeof node === 'boolean') return node;
    if (typeof node === 'number') return Number.isFinite(node) ? node : undefined;
    if (typeof node === 'string') return node.length <= MAX_RESULT_STRING_LENGTH ? node : undefined;
    if (depth >= MAX_RESULT_DEPTH || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      const items: TOwnerControlValue[] = [];
      for (const item of node) {
        const copied = copy(item, depth + 1);
        if (copied === undefined) return undefined;
        items.push(copied);
      }
      return items;
    }
    const record: Record<string, TOwnerControlValue> = {};
    for (const [key, item] of Object.entries(node)) {
      if (key === '__proto__' || key.length > MAX_RESULT_KEY_LENGTH) return undefined;
      const copied = copy(item, depth + 1);
      if (copied === undefined) return undefined;
      record[key] = copied;
    }
    return record;
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const copied = copy(value, 0);
  return copied === undefined ? undefined : (copied as TOwnerControlResult);
}

function questionFrom(value: unknown): TOwnerSessionQuestion | undefined {
  const kind = typeof value === 'object' && value !== null ? (value as TRecord)['kind'] : undefined;
  if (kind === 'open') return exactly(value, ['kind']) ? { kind: 'open' } : undefined;
  if (kind === 'accept') {
    const record = exactly(value, ['kind', 'digest', 'notice', 'question']);
    if (
      record === undefined ||
      !matches(record['digest'], DIGEST_PATTERN) ||
      !isText(record['notice'], MAX_TEXT_LENGTH) ||
      !isText(record['question'], MAX_TEXT_LENGTH)
    ) {
      return undefined;
    }
    return {
      kind: 'accept',
      digest: record['digest'],
      notice: record['notice'],
      question: record['question'],
    };
  }
  if (kind === 'refused') {
    const record = exactly(value, ['kind', 'message']);
    return record !== undefined && isText(record['message'], MAX_TEXT_LENGTH)
      ? { kind: 'refused', message: record['message'] }
      : undefined;
  }
  return undefined;
}

function custodyFrom(value: unknown): IRuntimeCustodyState | undefined {
  const record = exactly(value, ['unlocked', 'certified']);
  return record !== undefined &&
    typeof record['unlocked'] === 'boolean' &&
    typeof record['certified'] === 'boolean'
    ? { unlocked: record['unlocked'], certified: record['certified'] }
    : undefined;
}

/** One request from a client, or `undefined` for anything that is not exactly one. */
export function decodeOwnerRequest(bytes: Uint8Array): TOwnerRequest | undefined {
  const value = parse(bytes);
  const op = typeof value === 'object' && value !== null ? (value as TRecord)['op'] : undefined;
  switch (op) {
    case 'install-trust-root': {
      const record = exactly(value, ['op', 'requestId', 'attachPublicKey', 'certificate']);
      const attachPublicKey = bytesFrom(record?.['attachPublicKey'], ATTACH_PUBLIC_KEY_BYTES);
      const certificate = bytesFrom(record?.['certificate'], CERTIFICATE_BYTES);
      if (!matches(record?.['requestId'], REQUEST_ID_PATTERN) || !attachPublicKey || !certificate) {
        return undefined;
      }
      return { op, requestId: record['requestId'], root: { attachPublicKey, certificate } };
    }
    case 'lock': {
      const record = exactly(value, ['op', 'requestId', 'reason']);
      const reason = record?.['reason'];
      if (
        !matches(record?.['requestId'], REQUEST_ID_PATTERN) ||
        typeof reason !== 'string' ||
        !LOCK_REASONS.has(reason)
      ) {
        return undefined;
      }
      return { op, requestId: record['requestId'], reason: reason as TRequestedLockReason };
    }
    case 'question': {
      const record = exactly(value, ['op', 'requestId', 'sessionId']);
      if (
        !matches(record?.['requestId'], REQUEST_ID_PATTERN) ||
        !matches(record['sessionId'], SESSION_ID_PATTERN)
      ) {
        return undefined;
      }
      return { op, requestId: record['requestId'], sessionId: record['sessionId'] };
    }
    case 'open-accepted': {
      const record = exactly(value, ['op', 'requestId', 'bindingId', 'sessionId', 'acceptedDigest']);
      if (
        !matches(record?.['requestId'], REQUEST_ID_PATTERN) ||
        !matches(record['bindingId'], SESSION_ID_PATTERN) ||
        !matches(record['sessionId'], SESSION_ID_PATTERN) ||
        !matches(record['acceptedDigest'], DIGEST_PATTERN)
      ) {
        return undefined;
      }
      return {
        op,
        requestId: record['requestId'],
        bindingId: record['bindingId'],
        sessionId: record['sessionId'],
        acceptedDigest: record['acceptedDigest'],
      };
    }
    case 'control': {
      const record = exactly(value, ['op', 'requestId', 'command', 'fields']);
      const fields = fieldsFrom(record?.['fields']);
      if (
        !matches(record?.['requestId'], REQUEST_ID_PATTERN) ||
        !matches(record['command'], COMMAND_PATTERN) ||
        !fields
      ) {
        return undefined;
      }
      return {
        op,
        requestId: record['requestId'],
        request: { command: record['command'], fields },
      };
    }
    default:
      return undefined;
  }
}

/** One reply or notice from the runtime, or `undefined` for anything that is not exactly one. */
export function decodeRuntimeMessage(bytes: Uint8Array): TRuntimeMessage | undefined {
  const value = parse(bytes);
  const op = typeof value === 'object' && value !== null ? (value as TRecord)['op'] : undefined;
  switch (op) {
    case 'done': {
      const record = exactly(value, ['op', 'requestId']);
      return matches(record?.['requestId'], REQUEST_ID_PATTERN)
        ? { op, requestId: record['requestId'] }
        : undefined;
    }
    case 'unlocked': {
      const record = exactly(value, ['op', 'requestId', 'sealingKey']);
      const sealingKey = record?.['sealingKey'];
      if (
        !matches(record?.['requestId'], GRANT_ID_PATTERN) ||
        typeof sealingKey !== 'string' ||
        !GRANT_OUTCOMES.has(sealingKey)
      ) {
        return undefined;
      }
      return { op, requestId: record['requestId'], sealingKey: sealingKey as TGrantOutcome };
    }
    case 'question': {
      const record = exactly(value, ['op', 'requestId', 'question']);
      const question = questionFrom(record?.['question']);
      return matches(record?.['requestId'], REQUEST_ID_PATTERN) && question
        ? { op, requestId: record['requestId'], question }
        : undefined;
    }
    case 'refused': {
      const record = exactly(value, ['op', 'requestId', 'code', 'message']);
      const requestId = record?.['requestId'];
      if (
        !(matches(requestId, REQUEST_ID_PATTERN) || matches(requestId, GRANT_ID_PATTERN)) ||
        !matches(record?.['code'], REFUSAL_CODE_PATTERN) ||
        !isText(record['message'], MAX_REFUSAL_MESSAGE_LENGTH)
      ) {
        return undefined;
      }
      return { op, requestId, code: record['code'], message: record['message'] };
    }
    case 'control': {
      const record = exactly(value, ['op', 'requestId', 'result']);
      const result = resultFrom(record?.['result']);
      return matches(record?.['requestId'], REQUEST_ID_PATTERN) && result
        ? { op, requestId: record['requestId'], result }
        : undefined;
    }
    case 'custody': {
      const record = exactly(value, ['op', 'state']);
      const state = custodyFrom(record?.['state']);
      return state ? { op, state } : undefined;
    }
    default:
      return undefined;
  }
}

function wireRequest(request: TOwnerRequest): Record<string, unknown> {
  switch (request.op) {
    case 'install-trust-root':
      return {
        op: request.op,
        requestId: request.requestId,
        attachPublicKey: Buffer.from(request.root.attachPublicKey).toString('base64url'),
        certificate: Buffer.from(request.root.certificate).toString('base64url'),
      };
    case 'control':
      return {
        op: request.op,
        requestId: request.requestId,
        command: request.request.command,
        fields: { ...request.request.fields },
      };
    default:
      return { ...request };
  }
}

function checked<TMessage>(
  bytes: Uint8Array,
  decode: (bytes: Uint8Array) => TMessage | undefined,
): Uint8Array {
  if (decode(bytes) === undefined) {
    throw new RangeError('The message is outside the owner vocabulary.');
  }
  return bytes;
}

/** The bytes of `request`; throws `RangeError` for one the runtime would refuse to decode. */
export function encodeOwnerRequest(request: TOwnerRequest): Uint8Array {
  return checked(Buffer.from(JSON.stringify(wireRequest(request)), 'utf8'), decodeOwnerRequest);
}

/** The bytes of `message`; throws `RangeError` for one a client would refuse to decode. */
export function encodeRuntimeMessage(message: TRuntimeMessage): Uint8Array {
  return checked(Buffer.from(JSON.stringify(message), 'utf8'), decodeRuntimeMessage);
}
