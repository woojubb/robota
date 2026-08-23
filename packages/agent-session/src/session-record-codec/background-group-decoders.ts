/**
 * TRANS-005 (#2081) — the job-group half of the persisted background state: a group, the per-task
 * result envelopes it collects, and the three-variant group event union.
 *
 * A group's `results` are decoded even when the group is still `running`, because the array is
 * present from creation and a half-filled one is normal rather than a defect.
 */

import { TASK_STATUSES, decodeBackgroundTaskError } from './background-task-members.js';
import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeArray,
  decodeDeclaredObject,
  decodeLiteral,
  decodeOptional,
  decodeString,
  decodeStringArray,
  decodeTimestampString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  IBackgroundJobGroupState,
  IBackgroundJobResultEnvelope,
  TBackgroundJobGroupEvent,
  TBackgroundJobGroupStatus,
  TBackgroundJobWaitPolicy,
} from '@robota-sdk/agent-interface-execution';

const WAIT_POLICIES = [
  'detached',
  'wait_all',
  'wait_any',
  'manual',
] as const satisfies readonly TBackgroundJobWaitPolicy[];

const GROUP_STATUSES = [
  'running',
  'completed',
] as const satisfies readonly TBackgroundJobGroupStatus[];

const GROUP_EVENT_TYPES = [
  'background_job_group_created',
  'background_job_group_updated',
  'background_job_group_completed',
] as const;

function decodeJobResultEnvelope(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundJobResultEnvelope | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'taskId',
    'label',
    'status',
    'summary',
    'outputRef',
    'error',
    'startedAt',
    'completedAt',
  ]);
  if (raw === undefined) return undefined;
  const taskId = decodeString(raw['taskId'], atKey(path, 'taskId'), issues);
  const label = decodeString(raw['label'], atKey(path, 'label'), issues);
  const status = decodeLiteral(raw['status'], TASK_STATUSES, atKey(path, 'status'), issues);
  if (taskId === undefined || label === undefined || status === undefined) return undefined;
  const envelope: IBackgroundJobResultEnvelope = { taskId, label, status };
  for (const key of ['summary', 'outputRef'] as const) {
    setOptional(envelope, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }
  for (const key of ['startedAt', 'completedAt'] as const) {
    setOptional(
      envelope,
      key,
      decodeOptional(raw[key], atKey(path, key), issues, decodeTimestampString),
    );
  }
  setOptional(
    envelope,
    'error',
    decodeOptional(raw['error'], atKey(path, 'error'), issues, decodeBackgroundTaskError),
  );
  return envelope;
}

export function decodeJobGroupState(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundJobGroupState | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'id',
    'parentSessionId',
    'waitPolicy',
    'taskIds',
    'status',
    'createdAt',
    'updatedAt',
    'label',
    'completedAt',
    'results',
  ]);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const parentSessionId = decodeString(
    raw['parentSessionId'],
    atKey(path, 'parentSessionId'),
    issues,
  );
  const waitPolicy = decodeLiteral(
    raw['waitPolicy'],
    WAIT_POLICIES,
    atKey(path, 'waitPolicy'),
    issues,
  );
  const taskIds = decodeStringArray(raw['taskIds'], atKey(path, 'taskIds'), issues);
  const status = decodeLiteral(raw['status'], GROUP_STATUSES, atKey(path, 'status'), issues);
  const createdAt = decodeTimestampString(raw['createdAt'], atKey(path, 'createdAt'), issues);
  const updatedAt = decodeTimestampString(raw['updatedAt'], atKey(path, 'updatedAt'), issues);
  const results = decodeArray(
    raw['results'],
    atKey(path, 'results'),
    issues,
    decodeJobResultEnvelope,
  );
  if (
    id === undefined ||
    parentSessionId === undefined ||
    waitPolicy === undefined ||
    taskIds === undefined ||
    status === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    results === undefined
  ) {
    return undefined;
  }
  const group: IBackgroundJobGroupState = {
    id,
    parentSessionId,
    waitPolicy,
    taskIds,
    status,
    createdAt,
    updatedAt,
    results,
  };
  setOptional(
    group,
    'label',
    decodeOptional(raw['label'], atKey(path, 'label'), issues, decodeString),
  );
  setOptional(
    group,
    'completedAt',
    decodeOptional(raw['completedAt'], atKey(path, 'completedAt'), issues, decodeTimestampString),
  );
  return group;
}

export function decodeBackgroundJobGroupEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundJobGroupEvent | undefined {
  const type = decodeLiteral(
    (value as { type?: unknown } | null)?.type,
    GROUP_EVENT_TYPES,
    atKey(path, 'type'),
    issues,
  );
  if (type === undefined) return undefined;
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'group']);
  if (raw === undefined) return undefined;
  const group = decodeJobGroupState(raw['group'], atKey(path, 'group'), issues);
  return group === undefined ? undefined : { type, group };
}
