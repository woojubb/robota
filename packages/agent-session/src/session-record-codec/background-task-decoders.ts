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
import { addIssue, atKey, setOptional } from './decode-outcome.js';
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
import type {
  IAgentBackgroundTaskState,
  IBackgroundTaskState,
  IProcessBackgroundTaskState,
  IScheduledBackgroundTaskState,
  IToolInvocationBackgroundTaskState,
} from '@robota-sdk/agent-interface-execution';

/**
 * #2079: the base members shared by every kind — identical across the four discriminated members,
 * so `IAgentBackgroundTaskState` (any one member would do) is the source for their shape here.
 */
type TBaseBackgroundTaskState = Pick<
  IAgentBackgroundTaskState,
  | 'id'
  | 'label'
  | 'status'
  | 'mode'
  | 'parentSessionId'
  | 'parentTaskId'
  | 'depth'
  | 'cwd'
  | 'pid'
  | 'startedAt'
  | 'updatedAt'
  | 'lastActivityAt'
  | 'completedAt'
  | 'currentAction'
  | 'unread'
  | 'error'
  | 'logPath'
  | 'transcriptPath'
  | 'timeoutReason'
  | 'metadata'
>;

/** Base string members every kind may carry (#2079: `logPath`/`transcriptPath`/`pid` are shared — see contracts). */
const BASE_OPTIONAL_STRING_KEYS = ['parentTaskId', 'currentAction', 'logPath', 'transcriptPath'] as const;
/** #2079: agent-only string members — a value here on a non-agent task is a corrupt cross-kind field. */
const AGENT_OPTIONAL_STRING_KEYS = [
  'agentType',
  'resumeSessionId',
  'promptPreview',
  'worktreePath',
  'branchName',
  'worktreeStatus',
  'worktreeNextAction',
  'worktreeBaseRevision',
  'parentWorktreeStatus',
] as const;
/** #2079: produced by every runner except the agent one (a process command, an MCP tool summary, a schedule's shell command / wake instruction). */
const NON_AGENT_OPTIONAL_STRING_KEYS = ['commandPreview'] as const;

const OPTIONAL_TIMESTAMP_KEYS = ['startedAt', 'lastActivityAt', 'completedAt'] as const;

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
  'nextFireAt',
  'metadata',
  ...BASE_OPTIONAL_STRING_KEYS,
  ...AGENT_OPTIONAL_STRING_KEYS,
  ...NON_AGENT_OPTIONAL_STRING_KEYS,
  ...OPTIONAL_TIMESTAMP_KEYS,
];

/**
 * TRANS-005 (#2081), discriminated by kind (#2079): the persisted state carries base members every
 * kind may set, plus a set of kind-exclusive members — agent-only (`agentType`, `isolation`,
 * `resumeSessionId`, `promptPreview`, the worktree-isolation fields), scheduled-only (`schedule`,
 * `nextFireAt`), or produced by every runner except the agent one (`commandPreview`). A value on a
 * field outside its own kind is reported as corrupt at that field's own path — exactly how
 * `decodeBackgroundTaskResult` (#2079) and the pre-existing `result.kind` check just below already
 * treat a cross-kind field — and the switch below then builds only the fields that belong to the
 * decoded `kind`, so a foreign field never reaches the returned object even though it was read (and
 * flagged) above.
 */
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

  const base: TBaseBackgroundTaskState = {
    id,
    label,
    status,
    mode,
    parentSessionId,
    depth,
    cwd,
    updatedAt,
    unread,
  };
  for (const key of BASE_OPTIONAL_STRING_KEYS) {
    setOptional(base, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }
  for (const key of OPTIONAL_TIMESTAMP_KEYS) {
    setOptional(base, key, decodeOptional(raw[key], atKey(path, key), issues, decodeTimestampString));
  }
  setOptional(base, 'pid', decodeOptional(raw['pid'], atKey(path, 'pid'), issues, decodeInteger));
  setOptional(
    base,
    'timeoutReason',
    decodeOptional(
      raw['timeoutReason'],
      atKey(path, 'timeoutReason'),
      issues,
      (member, memberPath, sink) => decodeLiteral(member, TASK_TIMEOUT_REASONS, memberPath, sink),
    ),
  );
  setOptional(
    base,
    'metadata',
    decodeOptional(raw['metadata'], atKey(path, 'metadata'), issues, decodePrimitiveMap),
  );
  setOptional(
    base,
    'error',
    decodeOptional(raw['error'], atKey(path, 'error'), issues, decodeBackgroundTaskError),
  );

  const result = decodeOptional(raw['result'], atKey(path, 'result'), issues, decodeBackgroundTaskResult);
  if (result !== undefined) {
    if (result.taskId !== id) {
      addIssue(issues, atKey(atKey(path, 'result'), 'taskId'), 'must match the task ID');
    }
    if (result.kind !== kind) {
      addIssue(issues, atKey(atKey(path, 'result'), 'kind'), 'must match the task kind');
    }
  }

  const agentType = decodeOptional(raw['agentType'], atKey(path, 'agentType'), issues, decodeString);
  const resumeSessionId = decodeOptional(
    raw['resumeSessionId'],
    atKey(path, 'resumeSessionId'),
    issues,
    decodeString,
  );
  const promptPreview = decodeOptional(
    raw['promptPreview'],
    atKey(path, 'promptPreview'),
    issues,
    decodeString,
  );
  const isolation = decodeOptional(
    raw['isolation'],
    atKey(path, 'isolation'),
    issues,
    (member, memberPath, sink) => decodeLiteral(member, TASK_ISOLATIONS, memberPath, sink),
  );
  const worktreeFields: Record<string, string | undefined> = {};
  for (const key of [
    'worktreePath',
    'branchName',
    'worktreeStatus',
    'worktreeNextAction',
    'worktreeBaseRevision',
    'parentWorktreeStatus',
  ] as const) {
    worktreeFields[key] = decodeOptional(raw[key], atKey(path, key), issues, decodeString);
  }
  for (const key of AGENT_OPTIONAL_STRING_KEYS) {
    const decodedValue =
      key === 'agentType'
        ? agentType
        : key === 'resumeSessionId'
          ? resumeSessionId
          : key === 'promptPreview'
            ? promptPreview
            : worktreeFields[key];
    if (kind !== 'agent' && decodedValue !== undefined) {
      addIssue(issues, atKey(path, key), `must not be set for a '${kind}' task`);
    }
  }
  if (kind !== 'agent' && isolation !== undefined) {
    addIssue(issues, atKey(path, 'isolation'), `must not be set for a '${kind}' task`);
  }

  const commandPreview = decodeOptional(
    raw['commandPreview'],
    atKey(path, 'commandPreview'),
    issues,
    decodeString,
  );
  if (kind === 'agent' && commandPreview !== undefined) {
    addIssue(issues, atKey(path, 'commandPreview'), `must not be set for a '${kind}' task`);
  }

  const schedule = decodeOptional(
    raw['schedule'],
    atKey(path, 'schedule'),
    issues,
    decodeBackgroundTaskSchedule,
  );
  const nextFireAt = decodeOptional(
    raw['nextFireAt'],
    atKey(path, 'nextFireAt'),
    issues,
    decodeTimestampString,
  );
  if (kind !== 'scheduled' && schedule !== undefined) {
    addIssue(issues, atKey(path, 'schedule'), `must not be set for a '${kind}' task`);
  }
  if (kind !== 'scheduled' && nextFireAt !== undefined) {
    addIssue(issues, atKey(path, 'nextFireAt'), `must not be set for a '${kind}' task`);
  }

  switch (kind) {
    case 'agent': {
      const correlatedResult = result?.kind === 'agent' ? result : undefined;
      const task: IAgentBackgroundTaskState = { ...base, kind };
      setOptional(task, 'result', correlatedResult);
      setOptional(task, 'agentType', agentType);
      setOptional(task, 'resumeSessionId', resumeSessionId);
      setOptional(task, 'promptPreview', promptPreview);
      setOptional(task, 'isolation', isolation);
      setOptional(task, 'worktreePath', worktreeFields['worktreePath']);
      setOptional(task, 'branchName', worktreeFields['branchName']);
      setOptional(task, 'worktreeStatus', worktreeFields['worktreeStatus']);
      setOptional(task, 'worktreeNextAction', worktreeFields['worktreeNextAction']);
      setOptional(task, 'worktreeBaseRevision', worktreeFields['worktreeBaseRevision']);
      setOptional(task, 'parentWorktreeStatus', worktreeFields['parentWorktreeStatus']);
      return task;
    }
    case 'process': {
      const correlatedResult = result?.kind === 'process' ? result : undefined;
      const task: IProcessBackgroundTaskState = { ...base, kind };
      setOptional(task, 'result', correlatedResult);
      setOptional(task, 'commandPreview', commandPreview);
      return task;
    }
    case 'tool-invocation': {
      const correlatedResult = result?.kind === 'tool-invocation' ? result : undefined;
      const task: IToolInvocationBackgroundTaskState = { ...base, kind };
      setOptional(task, 'result', correlatedResult);
      setOptional(task, 'commandPreview', commandPreview);
      return task;
    }
    case 'scheduled': {
      const correlatedResult = result?.kind === 'scheduled' ? result : undefined;
      const task: IScheduledBackgroundTaskState = { ...base, kind };
      setOptional(task, 'result', correlatedResult);
      setOptional(task, 'commandPreview', commandPreview);
      setOptional(task, 'schedule', schedule);
      setOptional(task, 'nextFireAt', nextFireAt);
      return task;
    }
  }
}
