/**
 * TRANS-005 (#2081) — the member contracts a background-task state is built from: the literal
 * unions it selects from, its error, its result (with token usage), and its schedule.
 *
 * They live beside the state decoder rather than inside it because the task EVENT union carries the
 * same members, and one decoder per contract is the property this codec exists to establish.
 */

import { addIssue, atKey, setOptional } from './decode-outcome.js';
import {
  decodeBackgroundPrimitive,
  decodeBoolean,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeOpenMap,
  decodeOptional,
  decodeString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { ITokenUsage } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskError,
  IBackgroundTaskResult,
  IBackgroundTaskSchedule,
  TBackgroundPrimitive,
  TBackgroundTaskErrorCategory,
  TBackgroundTaskIsolation,
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
  TBackgroundTaskTimeoutReason,
} from '@robota-sdk/agent-interface-execution';

export const TASK_KINDS = [
  'agent',
  'process',
  'scheduled',
  // Contained — DATA-010.
  'tool-invocation',
] as const satisfies readonly TBackgroundTaskKind[];
export const TASK_MODES = [
  'foreground',
  'background',
] as const satisfies readonly TBackgroundTaskMode[];
export const TASK_ISOLATIONS = [
  'none',
  'worktree',
] as const satisfies readonly TBackgroundTaskIsolation[];
export const TASK_STATUSES = [
  'queued',
  'running',
  'waiting_permission',
  'sleeping',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly TBackgroundTaskStatus[];
export const TASK_TIMEOUT_REASONS = [
  'idle',
  'max_runtime',
  'output_limit',
  'repetition',
  'stale_worker',
] as const satisfies readonly TBackgroundTaskTimeoutReason[];
const TASK_ERROR_CATEGORIES = [
  'validation',
  'capacity',
  'permission',
  'timeout',
  'runner',
  'crash',
  'provider',
  'process',
] as const satisfies readonly TBackgroundTaskErrorCategory[];

export function decodePrimitiveMap(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): Record<string, TBackgroundPrimitive> | undefined {
  return decodeOpenMap(value, path, issues, decodeBackgroundPrimitive);
}

function decodeStringMap(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): Record<string, string> | undefined {
  return decodeOpenMap(value, path, issues, decodeString);
}

export function decodeBackgroundTaskError(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundTaskError | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['category', 'message', 'recoverable']);
  if (raw === undefined) return undefined;
  const category = decodeLiteral(
    raw['category'],
    TASK_ERROR_CATEGORIES,
    atKey(path, 'category'),
    issues,
  );
  const message = decodeString(raw['message'], atKey(path, 'message'), issues);
  const recoverable = decodeBoolean(raw['recoverable'], atKey(path, 'recoverable'), issues);
  if (category === undefined || message === undefined || recoverable === undefined)
    return undefined;
  return { category, message, recoverable };
}

function decodeTokenUsage(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ITokenUsage | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'promptTokens',
    'completionTokens',
    'totalTokens',
  ]);
  if (raw === undefined) return undefined;
  const promptTokens = decodeInteger(raw['promptTokens'], atKey(path, 'promptTokens'), issues);
  const completionTokens = decodeInteger(
    raw['completionTokens'],
    atKey(path, 'completionTokens'),
    issues,
  );
  const totalTokens = decodeInteger(raw['totalTokens'], atKey(path, 'totalTokens'), issues);
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

export function decodeBackgroundTaskResult(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundTaskResult | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'taskId',
    'kind',
    'output',
    'exitCode',
    'signalCode',
    'metadata',
    'usage',
  ]);
  if (raw === undefined) return undefined;
  const taskId = decodeString(raw['taskId'], atKey(path, 'taskId'), issues);
  const kind = decodeLiteral(raw['kind'], TASK_KINDS, atKey(path, 'kind'), issues);
  const output = decodeString(raw['output'], atKey(path, 'output'), issues);
  if (taskId === undefined || kind === undefined || output === undefined) return undefined;
  const exitCode = decodeOptional(raw['exitCode'], atKey(path, 'exitCode'), issues, decodeInteger);
  const signalCode = decodeOptional(raw['signalCode'], atKey(path, 'signalCode'), issues, decodeString);
  const metadata = decodeOptional(raw['metadata'], atKey(path, 'metadata'), issues, decodePrimitiveMap);
  const usage = decodeOptional(raw['usage'], atKey(path, 'usage'), issues, decodeTokenUsage);
  // #2079: `exitCode`/`signalCode` are process-only and `usage` is agent-only — a persisted result
  // carrying a field outside its own kind is corrupt, reported the same way the #3041 taskId/kind
  // identity check is: an issue at the offending field's own path, not a thrown error.
  if (kind !== 'process' && exitCode !== undefined) {
    addIssue(issues, atKey(path, 'exitCode'), `must not be set for a '${kind}' result`);
  }
  if (kind !== 'process' && signalCode !== undefined) {
    addIssue(issues, atKey(path, 'signalCode'), `must not be set for a '${kind}' result`);
  }
  if (kind !== 'agent' && usage !== undefined) {
    addIssue(issues, atKey(path, 'usage'), `must not be set for a '${kind}' result`);
  }
  // `kind` is decoded generically (any of the four literals), so no single member of the
  // discriminated union is the structural target here — the same runtime-only correlation
  // `background-task-manager-state.ts` casts around when dispatching to a runner by kind. The cross-
  // kind checks above are what make the cast sound: an object carrying a foreign field never reaches
  // a caller without also carrying an issue that turns the whole decode `corrupt`.
  const result: Record<string, unknown> = { taskId, kind, output };
  if (exitCode !== undefined) result['exitCode'] = exitCode;
  if (signalCode !== undefined) result['signalCode'] = signalCode;
  if (metadata !== undefined) result['metadata'] = metadata;
  if (usage !== undefined) result['usage'] = usage;
  return result as unknown as IBackgroundTaskResult;
}

export function decodeBackgroundTaskSchedule(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IBackgroundTaskSchedule | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'cronExpression',
    'agentInstruction',
    'command',
    'shell',
    'env',
  ]);
  if (raw === undefined) return undefined;
  const cronExpression = decodeString(raw['cronExpression'], atKey(path, 'cronExpression'), issues);
  if (cronExpression === undefined) return undefined;
  const schedule: IBackgroundTaskSchedule = { cronExpression };
  for (const key of ['agentInstruction', 'command', 'shell'] as const) {
    setOptional(schedule, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }
  setOptional(
    schedule,
    'env',
    decodeOptional(raw['env'], atKey(path, 'env'), issues, decodeStringMap),
  );
  return schedule;
}
