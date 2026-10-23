import type { ISessionPendingExecution } from '@robota-sdk/agent-interface-session';
import type { IToolWaitRequest, TToolParameters, TUniversalMessage } from '@robota-sdk/agent-core';
import { addIssue, atKey } from './decode-outcome.js';
import type { TDecodeIssues } from './decode-outcome.js';
import {
  decodeArray,
  decodeDeclaredObject,
  decodeOpenMap,
  decodeString,
  decodeUniversalValue,
} from './scalars.js';

function nonempty(value: unknown, path: string, issues: TDecodeIssues): string | undefined {
  const text = decodeString(value, path, issues);
  if (text !== undefined && text.trim().length > 0) return text;
  if (text !== undefined) addIssue(issues, path, 'expected a nonempty identity');
  return undefined;
}
function finiteJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || value instanceof Date || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  seen.add(value);
  const valid = (Array.isArray(value) ? value : Object.values(value)).every((child) =>
    finiteJson(child, seen),
  );
  seen.delete(value);
  return valid;
}
function decodeWait(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IToolWaitRequest | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'executionId',
    'actionId',
    'parentCallId',
    'toolCallId',
    'toolName',
    'requestId',
    'kind',
    'data',
  ]);
  if (!raw) return undefined;
  const executionId = nonempty(raw.executionId, atKey(path, 'executionId'), issues);
  const actionId = nonempty(raw.actionId, atKey(path, 'actionId'), issues);
  const parentCallId = nonempty(raw.parentCallId, atKey(path, 'parentCallId'), issues);
  const toolCallId = nonempty(raw.toolCallId, atKey(path, 'toolCallId'), issues);
  const toolName = nonempty(raw.toolName, atKey(path, 'toolName'), issues);
  const requestId = nonempty(raw.requestId, atKey(path, 'requestId'), issues);
  const kind = nonempty(raw.kind, atKey(path, 'kind'), issues);
  if (!finiteJson(raw.data)) {
    addIssue(issues, atKey(path, 'data'), 'expected finite JSON');
    return undefined;
  }
  const data: TToolParameters | undefined = decodeOpenMap(
    raw.data,
    atKey(path, 'data'),
    issues,
    decodeUniversalValue,
  );
  if (
    executionId === undefined ||
    actionId === undefined ||
    parentCallId === undefined ||
    toolCallId === undefined ||
    toolName === undefined ||
    requestId === undefined ||
    kind === undefined ||
    data === undefined
  )
    return undefined;
  return { executionId, actionId, parentCallId, toolCallId, toolName, requestId, kind, data };
}
export function decodePendingExecution(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ISessionPendingExecution | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['executionId', 'requests']);
  if (!raw) return undefined;
  const executionId = nonempty(raw.executionId, atKey(path, 'executionId'), issues);
  const requests = decodeArray(raw.requests, atKey(path, 'requests'), issues, decodeWait);
  if (executionId === undefined || requests === undefined) return undefined;
  return { executionId, requests };
}
/** Validate discovery against the terminal open round; this grants no journal authority. */
export function validatePendingExecution(
  pending: ISessionPendingExecution,
  messages: readonly TUniversalMessage[],
  issues: TDecodeIssues,
  path = 'pendingExecution',
): void {
  const index = messages.findLastIndex((message) => message.role === 'assistant');
  const assistant = messages[index];
  if (
    assistant?.role !== 'assistant' ||
    assistant.metadata?.executionId !== pending.executionId ||
    !messages.slice(index + 1).every((message) => message.role === 'tool')
  ) {
    addIssue(issues, path, 'pending execution must match the terminal assistant round');
    return;
  }
  const calls = new Map((assistant.toolCalls ?? []).map((call) => [call.id, call]));
  if (calls.size !== assistant.toolCalls?.length) addIssue(issues, path, 'tool call identities must be unique within a round');
  const receipts = messages.slice(index + 1).flatMap((message) => message.role === 'tool' ? [message] : []);
  const receiptIds = new Set<string>();
  for (const message of receipts) {
    const call = calls.get(message.toolCallId);
    if (!call || receiptIds.has(message.toolCallId) || (message.name !== undefined && message.name !== call.function.name)) addIssue(issues, path, 'terminal receipts must uniquely bind this round');
    receiptIds.add(message.toolCallId);
  }
  const answered = new Set(
    messages
      .slice(index + 1)
      .flatMap((message) => (message.role === 'tool' ? [message.toolCallId] : [])),
  );
  const open = new Map(
    (assistant.toolCalls ?? [])
      .filter((call) => !answered.has(call.id))
      .map((call) => [call.id, call]),
  );
  if (open.size === 0) addIssue(issues, path, 'pending execution requires unanswered calls');
  const ids = new Set<string>();
  const actions = new Map<string, string>();
  const callActions = new Map<string, string>();
  for (const request of pending.requests) {
    const call = open.get(request.toolCallId);
    const binding = JSON.stringify([request.parentCallId, request.toolCallId, request.toolName]);
    if (
      ids.has(request.requestId) ||
      request.executionId !== pending.executionId ||
      request.parentCallId !== assistant.metadata?.providerCallId ||
      !call ||
      call.function.name !== request.toolName ||
      (actions.has(request.actionId) && actions.get(request.actionId) !== binding) ||
      (callActions.has(request.toolCallId) && callActions.get(request.toolCallId) !== request.actionId)
    ) {
      addIssue(issues, path, 'wait identities must uniquely bind an open tool action');
    }
    ids.add(request.requestId);
    actions.set(request.actionId, binding);
    callActions.set(request.toolCallId, request.actionId);
  }
}
