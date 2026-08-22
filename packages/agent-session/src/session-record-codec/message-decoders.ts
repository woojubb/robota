/**
 * TRANS-005 (#2081) — decoders for the conversation half of a persisted session record:
 * message parts, tool calls, the four `TUniversalMessage` variants, and history entries.
 *
 * The message variants are discriminated by `role`, and each variant declares its OWN key set — a
 * `toolCallId` on a user message is a defect, not a spare field, because only the tool variant
 * declares one.
 */

import { addIssue, atKey, describeValue, setOptional } from './decode-outcome.js';
import {
  decodeArray,
  decodeDate,
  decodeLiteral,
  decodeDeclaredObject,
  decodeOpenMap,
  decodeOptional,
  decodeString,
  decodeUniversalValue,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  IHistoryEntry,
  ISystemMessage,
  IToolCall,
  IUserMessage,
  TMessageState,
  TUniversalMessage,
  TUniversalMessageMetadata,
  TUniversalMessagePart,
} from '@robota-sdk/agent-core';

const MESSAGE_STATES = ['complete', 'interrupted'] as const satisfies readonly TMessageState[];

const BASE_MESSAGE_KEYS = ['id', 'timestamp', 'state', 'metadata', 'role', 'content', 'parts'];

const MESSAGE_KEYS_BY_ROLE: Record<TUniversalMessage['role'], readonly string[]> = {
  user: [...BASE_MESSAGE_KEYS, 'name'],
  assistant: [...BASE_MESSAGE_KEYS, 'toolCalls'],
  system: [...BASE_MESSAGE_KEYS, 'name'],
  tool: [...BASE_MESSAGE_KEYS, 'toolCallId', 'name'],
};

/**
 * A metadata value: the declared union, checked member by member.
 *
 * `string[]`, `number[]` and `Record<string, number>` are distinguished by their contents rather
 * than by a tag, so a mixed array is a defect — the union has no member for it.
 */
function decodeMetadataValue(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TUniversalMessageMetadata[string] | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return value as string[];
    if (value.every((item) => typeof item === 'number')) return value as number[];
    addIssue(issues, path, 'expected an array of only strings or only numbers');
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const numbers: Record<string, number> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (typeof member !== 'number') {
        addIssue(issues, atKey(path, key), `expected a number, received ${describeValue(member)}`);
        continue;
      }
      numbers[key] = member;
    }
    return numbers;
  }
  addIssue(issues, path, `expected a metadata value, received ${describeValue(value)}`);
  return undefined;
}

function decodeMetadata(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TUniversalMessageMetadata | undefined {
  return decodeOpenMap(value, path, issues, decodeMetadataValue);
}

function decodeMessagePart(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TUniversalMessagePart | undefined {
  const kind = decodeLiteral(
    (value as { type?: unknown } | null)?.type,
    ['text', 'image_inline', 'image_uri'],
    atKey(path, 'type'),
    issues,
  );
  if (kind === undefined) return undefined;

  if (kind === 'text') {
    const raw = decodeDeclaredObject(value, path, issues, ['type', 'text']);
    if (raw === undefined) return undefined;
    const text = decodeString(raw['text'], atKey(path, 'text'), issues);
    return text === undefined ? undefined : { type: 'text', text };
  }

  if (kind === 'image_inline') {
    const raw = decodeDeclaredObject(value, path, issues, ['type', 'mimeType', 'data']);
    if (raw === undefined) return undefined;
    const mimeType = decodeString(raw['mimeType'], atKey(path, 'mimeType'), issues);
    const data = decodeString(raw['data'], atKey(path, 'data'), issues);
    if (mimeType === undefined || data === undefined) return undefined;
    return { type: 'image_inline', mimeType, data };
  }

  const raw = decodeDeclaredObject(value, path, issues, ['type', 'uri', 'mimeType']);
  if (raw === undefined) return undefined;
  const uri = decodeString(raw['uri'], atKey(path, 'uri'), issues);
  if (uri === undefined) return undefined;
  const part: TUniversalMessagePart = { type: 'image_uri', uri };
  setOptional(
    part,
    'mimeType',
    decodeOptional(raw['mimeType'], atKey(path, 'mimeType'), issues, decodeString),
  );
  return part;
}

function decodeToolCall(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IToolCall | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['id', 'type', 'function']);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const type = decodeLiteral(raw['type'], ['function'], atKey(path, 'type'), issues);
  const fnPath = atKey(path, 'function');
  const fn = decodeDeclaredObject(raw['function'], fnPath, issues, ['name', 'arguments']);
  const name =
    fn === undefined ? undefined : decodeString(fn['name'], atKey(fnPath, 'name'), issues);
  const args =
    fn === undefined
      ? undefined
      : decodeString(fn['arguments'], atKey(fnPath, 'arguments'), issues);
  if (id === undefined || type === undefined || name === undefined || args === undefined) {
    return undefined;
  }
  return { id, type, function: { name, arguments: args } };
}

/** Decode the members every message variant shares, into a partial the variant completes. */
function decodeMessageBase(
  raw: Record<string, unknown>,
  path: string,
  issues: TDecodeIssues,
): { id: string; timestamp: Date; state: TMessageState } | undefined {
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const timestamp = decodeDate(raw['timestamp'], atKey(path, 'timestamp'), issues);
  const state = decodeLiteral(raw['state'], MESSAGE_STATES, atKey(path, 'state'), issues);
  if (id === undefined || timestamp === undefined || state === undefined) return undefined;
  return { id, timestamp, state };
}

function applySharedOptionalMembers(
  message: TUniversalMessage,
  raw: Record<string, unknown>,
  path: string,
  issues: TDecodeIssues,
): void {
  setOptional(
    message,
    'metadata',
    decodeOptional(raw['metadata'], atKey(path, 'metadata'), issues, decodeMetadata),
  );
  setOptional(
    message,
    'parts',
    decodeOptional(raw['parts'], atKey(path, 'parts'), issues, (value, partsPath, sink) =>
      decodeArray(value, partsPath, sink, decodeMessagePart),
    ),
  );
}

export function decodeMessage(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TUniversalMessage | undefined {
  const role = decodeLiteral(
    (value as { role?: unknown } | null)?.role,
    ['user', 'assistant', 'system', 'tool'],
    atKey(path, 'role'),
    issues,
  );
  if (role === undefined) return undefined;

  const raw = decodeDeclaredObject(value, path, issues, MESSAGE_KEYS_BY_ROLE[role]);
  if (raw === undefined) return undefined;
  const base = decodeMessageBase(raw, path, issues);
  if (base === undefined) return undefined;
  const contentPath = atKey(path, 'content');

  if (role === 'assistant') {
    // The one variant whose content is nullable: an assistant turn that only calls tools has none.
    const content =
      raw['content'] === null ? null : decodeString(raw['content'], contentPath, issues);
    if (content === undefined) return undefined;
    const message: TUniversalMessage = { ...base, role, content };
    applySharedOptionalMembers(message, raw, path, issues);
    setOptional(
      message,
      'toolCalls',
      decodeOptional(raw['toolCalls'], atKey(path, 'toolCalls'), issues, (value, callsPath, sink) =>
        decodeArray(value, callsPath, sink, decodeToolCall),
      ),
    );
    return message;
  }

  const content = decodeString(raw['content'], contentPath, issues);
  if (content === undefined) return undefined;

  if (role === 'tool') {
    const toolCallId = decodeString(raw['toolCallId'], atKey(path, 'toolCallId'), issues);
    if (toolCallId === undefined) return undefined;
    const message: TUniversalMessage = { ...base, role, content, toolCallId };
    applySharedOptionalMembers(message, raw, path, issues);
    setOptional(
      message,
      'name',
      decodeOptional(raw['name'], atKey(path, 'name'), issues, decodeString),
    );
    return message;
  }

  // `role` is narrowed to `'user' | 'system'` here, and both variants declare `name` — the union of
  // the two is what makes that assignment checkable rather than a cast through the wider union.
  const message: IUserMessage | ISystemMessage = { ...base, role, content };
  applySharedOptionalMembers(message, raw, path, issues);
  setOptional(
    message,
    'name',
    decodeOptional(raw['name'], atKey(path, 'name'), issues, decodeString),
  );
  return message;
}

/**
 * A history entry. `data` is declared `unknown` by the contract, so it is checked only for being a
 * JSON-compatible value — its key set belongs to whatever wrote the entry, not to this contract.
 */
export function decodeHistoryEntry(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IHistoryEntry | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'id',
    'timestamp',
    'category',
    'type',
    'data',
  ]);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const timestamp = decodeDate(raw['timestamp'], atKey(path, 'timestamp'), issues);
  const category = decodeString(raw['category'], atKey(path, 'category'), issues);
  const type = decodeString(raw['type'], atKey(path, 'type'), issues);
  if (id === undefined || timestamp === undefined || category === undefined || type === undefined) {
    return undefined;
  }
  const entry: IHistoryEntry = { id, timestamp, category, type };
  setOptional(
    entry,
    'data',
    decodeOptional(raw['data'], atKey(path, 'data'), issues, decodeUniversalValue),
  );
  return entry;
}
