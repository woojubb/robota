import { atIndex, atKey, describeValue } from '../session-record-codec/decode-outcome.js';
import { decodeMessage } from '../session-record-codec/message-decoders.js';
import {
  decodeArray,
  decodeBoolean,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeNumber,
  decodeString,
} from '../session-record-codec/scalars.js';
import { decodeToolSchema } from '../session-record-codec/tool-schema-decoders.js';

import type { TDecodeIssues } from '../session-record-codec/decode-outcome.js';
import type { IContextWindowState, TUniversalValue } from '@robota-sdk/agent-core';

export type TFieldDecoder = (value: unknown, path: string, issues: TDecodeIssues) => unknown;
export type TPayloadShape = Readonly<Record<string, { decode: TFieldDecoder; optional?: boolean }>>;

export const required = (decode: TFieldDecoder): { decode: TFieldDecoder } => ({ decode });
export const optional = (decode: TFieldDecoder): { decode: TFieldDecoder; optional: true } => ({
  decode,
  optional: true,
});
export const strings = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  decodeArray(value, path, issues, decodeString);
export const messages = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  decodeArray(value, path, issues, decodeMessage);
export const schemas = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  decodeArray(value, path, issues, decodeToolSchema);
export const committedAssistant = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  typeof value === 'string' ? value : decodeMessage(value, path, issues);
export const nonNegativeInteger = (
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): unknown => {
  const decoded = decodeInteger(value, path, issues);
  if (decoded !== undefined && decoded < 0)
    issues.push({ path, message: 'expected a non-negative integer' });
  return decoded;
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function record(value: unknown, path: string, issues: TDecodeIssues): unknown {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: `expected an object, received ${describeValue(value)}` });
    return undefined;
  }
  for (const [key, member] of Object.entries(value)) json(member, atKey(path, key), issues);
  return value;
}

// IContextWindowState is the producer's four-field snapshot contract.
const CONTEXT_STATE_KEYS = [
  'maxTokens',
  'usedTokens',
  'usedPercentage',
  'remainingPercentage',
] as const satisfies readonly (keyof IContextWindowState)[];

export function contextState(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IContextWindowState | undefined {
  const raw = decodeDeclaredObject(value, path, issues, CONTEXT_STATE_KEYS);
  if (raw === undefined) return undefined;
  const maxTokens = decodeNumber(raw['maxTokens'], atKey(path, 'maxTokens'), issues);
  const usedTokens = decodeNumber(raw['usedTokens'], atKey(path, 'usedTokens'), issues);
  const usedPercentage = decodeNumber(raw['usedPercentage'], atKey(path, 'usedPercentage'), issues);
  const remainingPercentage = decodeNumber(
    raw['remainingPercentage'],
    atKey(path, 'remainingPercentage'),
    issues,
  );
  if (
    maxTokens === undefined ||
    usedTokens === undefined ||
    usedPercentage === undefined ||
    remainingPercentage === undefined
  )
    return undefined;
  return { maxTokens, usedTokens, usedPercentage, remainingPercentage };
}

// IOwnerPathSegment is owned by agent-core's event service: exactly { type, id }.
export const ownerPath = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  decodeArray(value, path, issues, (segment, segmentPath, sink) => {
    const raw = decodeDeclaredObject(segment, segmentPath, sink, ['type', 'id']);
    if (raw === undefined) return undefined;
    const type = decodeString(raw['type'], atKey(segmentPath, 'type'), sink);
    const id = decodeString(raw['id'], atKey(segmentPath, 'id'), sink);
    return type === undefined || id === undefined ? undefined : { type, id };
  });

// Provider-native payloads and tool result data have no provider-neutral member schema.
export function json(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  seen = new WeakSet<object>(),
): TUniversalValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value instanceof Date) {
    issues.push({
      path,
      message: `expected a JSON-compatible value, received ${describeValue(value)}`,
    });
    return undefined;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    issues.push({
      path,
      message: `expected a JSON-compatible object, received ${describeValue(value)}`,
    });
    return undefined;
  }
  if (seen.has(value)) {
    issues.push({ path, message: 'expected an acyclic JSON-compatible value' });
    return undefined;
  }
  seen.add(value);
  if (Array.isArray(value))
    for (let index = 0; index < value.length; index++)
      json(value[index], atIndex(path, index), issues, seen);
  else
    for (const [key, member] of Object.entries(value)) json(member, atKey(path, key), issues, seen);
  seen.delete(value);
  return value as TUniversalValue;
}

/** Structural preflight before calling recursive record decoders. */
export function checkContainerIntegrity(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
  seen = new WeakSet<object>(),
): void {
  if (typeof value !== 'object' || value === null || value instanceof Date) return;
  if (seen.has(value)) {
    issues.push({ path, message: 'expected an acyclic value' });
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        issues.push({
          path: atIndex(path, index),
          message: 'expected an array element, received nothing',
        });
      else checkContainerIntegrity(value[index], atIndex(path, index), issues, seen);
    }
  } else {
    for (const [key, member] of Object.entries(value))
      checkContainerIntegrity(member, atKey(path, key), issues, seen);
  }
  seen.delete(value);
}

export const literal =
  <T extends string>(...values: readonly T[]): TFieldDecoder =>
  (value, path, issues) =>
    decodeLiteral(value, values, path, issues);

export const historyStructure = (value: unknown, path: string, issues: TDecodeIssues): unknown =>
  decodeArray(value, path, issues, (item, itemPath, sink) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      sink.push({ path: itemPath, message: `expected an object, received ${describeValue(item)}` });
      return undefined;
    }
    const entry = item as Record<string, unknown>;
    decodeLiteral(
      entry['role'],
      ['user', 'assistant', 'system', 'tool'],
      atKey(itemPath, 'role'),
      sink,
    );
    nonNegativeInteger(entry['contentLength'], atKey(itemPath, 'contentLength'), sink);
    decodeBoolean(entry['hasToolCalls'], atKey(itemPath, 'hasToolCalls'), sink);
    strings(entry['toolCallNames'], atKey(itemPath, 'toolCallNames'), sink);
    if (entry['metadata'] !== undefined)
      record(entry['metadata'], atKey(itemPath, 'metadata'), sink);
    for (const key of Object.keys(entry))
      if (!['role', 'contentLength', 'hasToolCalls', 'toolCallNames', 'metadata'].includes(key))
        sink.push({ path: atKey(itemPath, key), message: 'unknown history structure field' });
    return entry;
  });
