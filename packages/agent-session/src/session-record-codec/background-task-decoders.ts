/**
 * TRANS-005 (#2081) — the background-task state decoder.
 *
 * The state carries thirteen optional plain-string members and four optional timestamp members.
 * They are decoded from key tables rather than written out one call at a time: a table is checked
 * against the contract by the key-parity test, whereas seventeen near-identical statements are
 * checked by whoever reads them.
 */

import {
  TASK_ISOLATIONS,
  TASK_KINDS,
  TASK_MODES,
  TASK_STATUSES,
  TASK_TIMEOUT_REASONS,
  decodeBackgroundTaskError,
  decodeBackgroundTaskResult,
  decodeBackgroundTaskSchedule,
  decodePrimitiveMap,
} from './background-task-members.js';
import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeBoolean,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeOptional,
  decodeString,
  decodeTimestampString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-transport';

const OPTIONAL_STRING_KEYS = [
  'agentType',
  'parentTaskId',
  'promptPreview',
  'commandPreview',
  'currentAction',
  'logPath',
  'transcriptPath',
  'worktreePath',
  'branchName',
  'worktreeStatus',
  'worktreeNextAction',
  'worktreeBaseRevision',
  'parentWorktreeStatus',
] as const;

const OPTIONAL_TIMESTAMP_KEYS = [
  'startedAt',
  'lastActivityAt',
  'completedAt',
  'nextFireAt',
] as const;

const TASK_STATE_KEYS: readonly string[] = [
  'id',
  'kind',
  'label',
  'status',
  'mode',
  'parentSessionId',
  'depth',
  'cwd',
  'pid',
  'updatedAt',
  'isolation',
  'unread',
  'result',
  'error',
  'timeoutReason',
  'schedule',
  'metadata',
  ...OPTIONAL_STRING_KEYS,
  ...OPTIONAL_TIMESTAMP_KEYS,
];

export function decodeBackgroundTaskState(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundTaskState | undefined {
  const raw = decodeDeclaredObject(value, path, issues, TASK_STATE_KEYS);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const kind = decodeLiteral(raw['kind'], TASK_KINDS, atKey(path, 'kind'), issues);
  const label = decodeString(raw['label'], atKey(path, 'label'), issues);
  const status = decodeLiteral(raw['status'], TASK_STATUSES, atKey(path, 'status'), issues);
  const mode = decodeLiteral(raw['mode'], TASK_MODES, atKey(path, 'mode'), issues);
  const parentSessionId = decodeString(
    raw['parentSessionId'],
    atKey(path, 'parentSessionId'),
    issues,
  );
  const depth = decodeInteger(raw['depth'], atKey(path, 'depth'), issues);
  const cwd = decodeString(raw['cwd'], atKey(path, 'cwd'), issues);
  const updatedAt = decodeTimestampString(raw['updatedAt'], atKey(path, 'updatedAt'), issues);
  const unread = decodeBoolean(raw['unread'], atKey(path, 'unread'), issues);
  if (
    id === undefined ||
    kind === undefined ||
    label === undefined ||
    status === undefined ||
    mode === undefined ||
    parentSessionId === undefined ||
    depth === undefined ||
    cwd === undefined ||
    updatedAt === undefined ||
    unread === undefined
  ) {
    return undefined;
  }

  const task: IBackgroundTaskState = {
    id,
    kind,
    label,
    status,
    mode,
    parentSessionId,
    depth,
    cwd,
    updatedAt,
    unread,
  };
  for (const key of OPTIONAL_STRING_KEYS) {
    setOptional(task, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }
  for (const key of OPTIONAL_TIMESTAMP_KEYS) {
    setOptional(
      task,
      key,
      decodeOptional(raw[key], atKey(path, key), issues, decodeTimestampString),
    );
  }
  setOptional(task, 'pid', decodeOptional(raw['pid'], atKey(path, 'pid'), issues, decodeInteger));
  setOptional(
    task,
    'isolation',
    decodeOptional(raw['isolation'], atKey(path, 'isolation'), issues, (member, memberPath, sink) =>
      decodeLiteral(member, TASK_ISOLATIONS, memberPath, sink),
    ),
  );
  setOptional(
    task,
    'timeoutReason',
    decodeOptional(
      raw['timeoutReason'],
      atKey(path, 'timeoutReason'),
      issues,
      (member, memberPath, sink) => decodeLiteral(member, TASK_TIMEOUT_REASONS, memberPath, sink),
    ),
  );
  setOptional(
    task,
    'result',
    decodeOptional(raw['result'], atKey(path, 'result'), issues, decodeBackgroundTaskResult),
  );
  setOptional(
    task,
    'error',
    decodeOptional(raw['error'], atKey(path, 'error'), issues, decodeBackgroundTaskError),
  );
  setOptional(
    task,
    'schedule',
    decodeOptional(raw['schedule'], atKey(path, 'schedule'), issues, decodeBackgroundTaskSchedule),
  );
  setOptional(
    task,
    'metadata',
    decodeOptional(raw['metadata'], atKey(path, 'metadata'), issues, decodePrimitiveMap),
  );
  return task;
}
