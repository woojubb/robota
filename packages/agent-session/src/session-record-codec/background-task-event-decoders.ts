/**
 * TRANS-005 (#2081) — the twelve-variant persisted background-task event union.
 *
 * The union is discriminated by `type`, and the discriminant is read FIRST: it selects the key set
 * the variant declares, so an event that names the wrong members fails on the members rather than on
 * the union. An unrecognised `type` is reported once, at `type`, instead of as a pile of
 * missing-member issues from whichever variant happened to be tried.
 */

import { decodeBackgroundTaskState } from './background-task-decoders.js';
import { decodePrimitiveMap } from './background-task-members.js';
import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeBoolean,
  decodeDeclaredObject,
  decodeLiteral,
  decodeOptional,
  decodeString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-execution';

/** The task-event variants whose entire payload is a task state. */
const TASK_CARRYING_EVENTS = [
  'background_task_created',
  'background_task_started',
  'background_task_updated',
  'background_task_completed',
  'background_task_failed',
  'background_task_cancelled',
] as const;

const TASK_EVENT_TYPES = [
  ...TASK_CARRYING_EVENTS,
  'background_task_text_delta',
  'background_task_tool_start',
  'background_task_tool_end',
  'background_task_permission_request',
  'background_task_closed',
  'background_task_waking',
] as const;

/** Every variant but the six task-carrying ones names the task by id rather than by value. */
function taskIdOf(
  raw: Record<string, unknown>,
  path: string,
  issues: TDecodeIssues,
): string | undefined {
  return decodeString(raw['taskId'], atKey(path, 'taskId'), issues);
}

type TTaskEventType = (typeof TASK_EVENT_TYPES)[number];

function decodeTextDeltaEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'taskId', 'delta']);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  const delta = decodeString(raw['delta'], atKey(path, 'delta'), issues);
  if (taskId === undefined || delta === undefined) return undefined;
  return { type: 'background_task_text_delta', taskId, delta };
}

function decodeToolStartEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'taskId', 'toolName', 'firstArg']);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  const toolName = decodeString(raw['toolName'], atKey(path, 'toolName'), issues);
  if (taskId === undefined || toolName === undefined) return undefined;
  const event: TBackgroundTaskEvent = { type: 'background_task_tool_start', taskId, toolName };
  setOptional(
    event,
    'firstArg',
    decodeOptional(raw['firstArg'], atKey(path, 'firstArg'), issues, decodeString),
  );
  return event;
}

function decodeToolEndEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'type',
    'taskId',
    'toolName',
    'success',
    'error',
  ]);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  const toolName = decodeString(raw['toolName'], atKey(path, 'toolName'), issues);
  const success = decodeBoolean(raw['success'], atKey(path, 'success'), issues);
  if (taskId === undefined || toolName === undefined || success === undefined) return undefined;
  const event: TBackgroundTaskEvent = {
    type: 'background_task_tool_end',
    taskId,
    toolName,
    success,
  };
  setOptional(
    event,
    'error',
    decodeOptional(raw['error'], atKey(path, 'error'), issues, decodeString),
  );
  return event;
}

function decodePermissionRequestEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'type',
    'taskId',
    'requestId',
    'toolName',
    'toolArgs',
  ]);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  const requestId = decodeString(raw['requestId'], atKey(path, 'requestId'), issues);
  const toolName = decodeString(raw['toolName'], atKey(path, 'toolName'), issues);
  const toolArgs = decodePrimitiveMap(raw['toolArgs'], atKey(path, 'toolArgs'), issues);
  if (
    taskId === undefined ||
    requestId === undefined ||
    toolName === undefined ||
    toolArgs === undefined
  ) {
    return undefined;
  }
  return { type: 'background_task_permission_request', taskId, requestId, toolName, toolArgs };
}

function decodeClosedEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'taskId']);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  return taskId === undefined ? undefined : { type: 'background_task_closed', taskId };
}

function decodeWakingEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'taskId', 'instruction']);
  if (raw === undefined) return undefined;
  const taskId = taskIdOf(raw, path, issues);
  if (taskId === undefined) return undefined;
  const event: TBackgroundTaskEvent = { type: 'background_task_waking', taskId };
  setOptional(
    event,
    'instruction',
    decodeOptional(raw['instruction'], atKey(path, 'instruction'), issues, decodeString),
  );
  return event;
}

/** A task-carrying variant: `{ type, task }`, where `task` is a whole task state. */
function decodeTaskCarryingEvent(
  type: TTaskEventType,
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['type', 'task']);
  if (raw === undefined) return undefined;
  const task = decodeBackgroundTaskState(raw['task'], atKey(path, 'task'), issues);
  if (task === undefined) return undefined;
  return { type, task } as TBackgroundTaskEvent;
}

/** The variant decoders, keyed by discriminant — the dispatcher stays a lookup, not a ladder. */
const VARIANT_DECODERS: Partial<
  Record<
    TTaskEventType,
    (value: unknown, path: string, issues: TDecodeIssues) => TBackgroundTaskEvent | undefined
  >
> = {
  background_task_text_delta: decodeTextDeltaEvent,
  background_task_tool_start: decodeToolStartEvent,
  background_task_tool_end: decodeToolEndEvent,
  background_task_permission_request: decodePermissionRequestEvent,
  background_task_closed: decodeClosedEvent,
  background_task_waking: decodeWakingEvent,
};

export function decodeBackgroundTaskEvent(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TBackgroundTaskEvent | undefined {
  const type = decodeLiteral(
    (value as { type?: unknown } | null)?.type,
    TASK_EVENT_TYPES,
    atKey(path, 'type'),
    issues,
  );
  if (type === undefined) return undefined;
  const decodeVariant = VARIANT_DECODERS[type];
  return decodeVariant === undefined
    ? decodeTaskCarryingEvent(type, value, path, issues)
    : decodeVariant(value, path, issues);
}
