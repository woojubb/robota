/**
 * TRANS-005 (#2081) — decoders for the session-event payloads a record persists: skill activation,
 * automatic-memory events and their references, and context references.
 *
 * These contracts spell their instants as `string`, not `Date`, so they stay strings here — but they
 * are still checked as instants, because a member that reads as a timestamp and cannot be parsed as
 * one is a defect that only surfaces later, as an ordering that is quietly wrong.
 */

import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeBoolean,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeNumber,
  decodeOpenMap,
  decodeOptional,
  decodeString,
  decodeTimestampString,
  decodeUniversalValue,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  IContextReferenceItem,
  IMemoryEvent,
  IMemoryReference,
  ISkillActivationEvent,
  TContextReferenceLoadType,
  TContextReferenceStatus,
  TSkillActivationInvocation,
  TSkillActivationMode,
  TSkillActivationSource,
  TSkillActivationStatus,
} from '@robota-sdk/agent-interface-session';

const SKILL_SOURCES = ['skill', 'plugin'] as const satisfies readonly TSkillActivationSource[];
const SKILL_INVOCATIONS = [
  'user-slash',
  'model-tool',
] as const satisfies readonly TSkillActivationInvocation[];
const SKILL_MODES = ['inject', 'fork'] as const satisfies readonly TSkillActivationMode[];
const SKILL_STATUSES = [
  'started',
  'completed',
  'failed',
] as const satisfies readonly TSkillActivationStatus[];

const MEMORY_EVENT_TYPES = [
  'memory_candidate_extracted',
  'memory_candidate_queued',
  'memory_candidate_saved',
  'memory_candidate_skipped',
  'memory_candidate_approved',
  'memory_candidate_rejected',
  'memory_retrieved',
] as const satisfies readonly IMemoryEvent['type'][];

const CONTEXT_LOAD_TYPES = [
  'manual',
  'prompt-reference',
  'system',
] as const satisfies readonly TContextReferenceLoadType[];

const CONTEXT_STATUSES = [
  'active',
  'observed',
] as const satisfies readonly TContextReferenceStatus[];

export function decodeSkillActivationEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ISkillActivationEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'type',
    'skillName',
    'source',
    'invocation',
    'mode',
    'status',
    'timestamp',
    'qualifiedName',
    'error',
  ]);
  if (raw === undefined) return undefined;
  const type = decodeLiteral(raw['type'], ['skill-activation'], atKey(path, 'type'), issues);
  const skillName = decodeString(raw['skillName'], atKey(path, 'skillName'), issues);
  const source = decodeLiteral(raw['source'], SKILL_SOURCES, atKey(path, 'source'), issues);
  const invocation = decodeLiteral(
    raw['invocation'],
    SKILL_INVOCATIONS,
    atKey(path, 'invocation'),
    issues,
  );
  const mode = decodeLiteral(raw['mode'], SKILL_MODES, atKey(path, 'mode'), issues);
  const status = decodeLiteral(raw['status'], SKILL_STATUSES, atKey(path, 'status'), issues);
  const timestamp = decodeTimestampString(raw['timestamp'], atKey(path, 'timestamp'), issues);
  if (
    type === undefined ||
    skillName === undefined ||
    source === undefined ||
    invocation === undefined ||
    mode === undefined ||
    status === undefined ||
    timestamp === undefined
  ) {
    return undefined;
  }
  const qualifiedName = decodeOptional(
    raw['qualifiedName'],
    atKey(path, 'qualifiedName'),
    issues,
    decodeString,
  );
  const error = decodeOptional(raw['error'], atKey(path, 'error'), issues, decodeString);
  // Every member is `readonly`, so the optional ones are spread in rather than assigned after.
  return {
    type,
    skillName,
    source,
    invocation,
    mode,
    status,
    timestamp,
    ...(qualifiedName === undefined ? {} : { qualifiedName }),
    ...(error === undefined ? {} : { error }),
  };
}

export function decodeMemoryReference(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IMemoryReference | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['topic', 'path', 'score', 'truncated']);
  if (raw === undefined) return undefined;
  const topic = decodeString(raw['topic'], atKey(path, 'topic'), issues);
  const referencePath = decodeString(raw['path'], atKey(path, 'path'), issues);
  const score = decodeNumber(raw['score'], atKey(path, 'score'), issues);
  const truncated = decodeBoolean(raw['truncated'], atKey(path, 'truncated'), issues);
  if (
    topic === undefined ||
    referencePath === undefined ||
    score === undefined ||
    truncated === undefined
  ) {
    return undefined;
  }
  return { topic, path: referencePath, score, truncated };
}

export function decodeMemoryEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IMemoryEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'type',
    'at',
    'candidateId',
    'topic',
    'reason',
    'data',
  ]);
  if (raw === undefined) return undefined;
  const type = decodeLiteral(raw['type'], MEMORY_EVENT_TYPES, atKey(path, 'type'), issues);
  const at = decodeTimestampString(raw['at'], atKey(path, 'at'), issues);
  if (type === undefined || at === undefined) return undefined;
  const event: IMemoryEvent = { type, at };
  for (const key of ['candidateId', 'topic', 'reason'] as const) {
    setOptional(event, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }
  setOptional(
    event,
    'data',
    decodeOptional(raw['data'], atKey(path, 'data'), issues, (member, memberPath, sink) =>
      decodeOpenMap(member, memberPath, sink, decodeUniversalValue),
    ),
  );
  return event;
}

export function decodeContextReferenceItem(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IContextReferenceItem | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'id',
    'sourcePath',
    'relativePath',
    'originalReference',
    'loadType',
    'status',
    'byteLength',
    'loadedAt',
    'lastUsedAt',
  ]);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const sourcePath = decodeString(raw['sourcePath'], atKey(path, 'sourcePath'), issues);
  const relativePath = decodeString(raw['relativePath'], atKey(path, 'relativePath'), issues);
  const originalReference = decodeString(
    raw['originalReference'],
    atKey(path, 'originalReference'),
    issues,
  );
  const loadType = decodeLiteral(
    raw['loadType'],
    CONTEXT_LOAD_TYPES,
    atKey(path, 'loadType'),
    issues,
  );
  const status = decodeLiteral(raw['status'], CONTEXT_STATUSES, atKey(path, 'status'), issues);
  const byteLength = decodeInteger(raw['byteLength'], atKey(path, 'byteLength'), issues);
  const loadedAt = decodeTimestampString(raw['loadedAt'], atKey(path, 'loadedAt'), issues);
  if (
    id === undefined ||
    sourcePath === undefined ||
    relativePath === undefined ||
    originalReference === undefined ||
    loadType === undefined ||
    status === undefined ||
    byteLength === undefined ||
    loadedAt === undefined
  ) {
    return undefined;
  }
  const item: IContextReferenceItem = {
    id,
    sourcePath,
    relativePath,
    originalReference,
    loadType,
    status,
    byteLength,
    loadedAt,
  };
  setOptional(
    item,
    'lastUsedAt',
    decodeOptional(raw['lastUsedAt'], atKey(path, 'lastUsedAt'), issues, decodeTimestampString),
  );
  return item;
}
