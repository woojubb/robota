import type {
  IExecutionRoundCheckpoint,
  TExecutionJournalRecord,
} from '../interfaces/execution-journal';
import type { IAssistantMessage } from '../interfaces/messages';
import type { IToolExecutionResult } from '../interfaces/tool';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { ARGUMENT_DECODE_ERROR_CODE } from './tool-execution-constants';
import type { IToolWaitState } from '../interfaces/tool-continuation';
import { continuationObject } from '../utils/continuation-json';

export interface IRecoveredAction {
  actionId: string;
  intent: boolean;
  dispatched: boolean;
  effectStarted: boolean;
  waits: IToolWaitState[];
  result?: IToolExecutionResult;
  loadedDeferredTools?: string[];
}
export interface IRecoveredToolBatch {
  checkpoint: IExecutionRoundCheckpoint;
  response: IAssistantMessage;
  actions: Map<string, IRecoveredAction>;
  offeredDeferredTools: string[];
}

/** Object insertion order is not part of a journal record's identity. */
export function recoveryValueKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return item;
  });
}

function invalid(message: string): never {
  throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', message);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a complete durable prefix before executing or publishing any recovered work. */
export function recoverToolBatch(
  source: readonly TExecutionJournalRecord[],
  executionId: string,
  callId: string,
  requireTools = true,
): IRecoveredToolBatch {
  try {
    return validateBatch(structuredClone(source), executionId, callId, requireTools);
  } catch (error) {
    if (error instanceof ExecutionRecoveryError) throw error;
    return invalid('Execution journal is not a valid recoverable record prefix');
  }
}

function validateBatch(
  source: readonly TExecutionJournalRecord[],
  executionId: string,
  callId: string,
  requireTools: boolean,
): IRecoveredToolBatch {
  if (!nonempty(executionId) || !nonempty(callId) || !Array.isArray(source))
    invalid('Missing recovery identity');
  const records: TExecutionJournalRecord[] = [];
  const seen = new Map<string, string>();
  let latestCall: string | undefined;
  const actionOwners = new Map<string, string>();
  const waits = new Map<string, Extract<TExecutionJournalRecord, { kind: 'tool-wait' }>>();
  const answered = new Set<string>();
  const responseIds = new Set<string>();
  for (const record of source) {
    if (!record || record.executionId !== executionId || !nonempty(record.recordId))
      invalid('Journal execution identity mismatch');
    const key = recoveryValueKey(record);
    const previous = seen.get(record.recordId);
    if (previous !== undefined) {
      if (key !== previous) invalid('Conflicting journal record identity');
      continue;
    }
    seen.set(record.recordId, key);
    records.push(record);
    if ('callId' in record) {
      if (!nonempty(record.callId)) invalid('Missing model call identity');
      if (record.kind === 'model-request' || record.kind === 'model-cache-hit')
        latestCall = record.callId;
      else if (record.callId !== latestCall) invalid('Model settlement crossed a newer invocation');
    } else if ('actionId' in record) {
      if (!nonempty(record.actionId) || !nonempty(record.parentCallId))
        invalid('Missing action identity');
      const owner = actionOwners.get(record.actionId);
      const binding = recoveryValueKey([record.parentCallId, record.toolCallId, record.toolName]);
      if (owner && owner !== binding) invalid('Action identity belongs to multiple calls');
      actionOwners.set(record.actionId, binding);
      if (record.kind === 'tool-wait') {
        if (
          !record.request ||
          !nonempty(record.request.requestId) ||
          !nonempty(record.request.kind) ||
          waits.has(record.request.requestId)
        )
          invalid('Invalid or duplicate tool wait');
        continuationObject(record.request.data);
        waits.set(record.request.requestId, record);
      }
      if (record.kind === 'tool-response') {
        const response = record.response;
        const wait = response && waits.get(response.requestId);
        if (
          !wait ||
          !nonempty(response.responseId) ||
          answered.has(response.requestId) ||
          responseIds.has(response.responseId) ||
          wait.actionId !== record.actionId ||
          wait.parentCallId !== record.parentCallId ||
          wait.toolCallId !== record.toolCallId ||
          wait.toolName !== record.toolName
        )
          invalid('Tool response does not belong to an unanswered request');
        continuationObject(response.response);
        answered.add(response.requestId);
        responseIds.add(response.responseId);
      }
    } else invalid('Unknown journal record');
  }
  if (latestCall !== callId) invalid('Only the latest model invocation can be recovered');
  let request: Extract<TExecutionJournalRecord, { kind: 'model-request' }> | undefined;
  let response: IAssistantMessage | undefined;
  let cachedCheckpoint: IExecutionRoundCheckpoint | undefined;
  const actions = new Map<string, IRecoveredAction>();
  for (const record of records) {
    if ('callId' in record) {
      if (record.callId !== callId) continue;
      if (record.kind === 'model-request') {
        if (request || response) invalid('Duplicate or out-of-order model request');
        request = record;
      } else if (record.kind === 'model-cache-hit') {
        if (request || response || record.response.role !== 'assistant')
          invalid('Invalid cache settlement');
        response = record.response;
        cachedCheckpoint = record.checkpoint;
      } else if (record.kind === 'model-response') {
        if (!request || response || record.response.role !== 'assistant')
          invalid('Invalid model response');
        response = record.response;
      } else invalid('This model invocation has no recoverable tool response');
      continue;
    }
    if (record.parentCallId !== callId) continue;
    if (!response) invalid('Tool action precedes its model response');
    const call = response.toolCalls?.find((candidate) => candidate.id === record.toolCallId);
    if (!call || record.toolName !== call.function.name)
      invalid('Action does not belong to the saved model response');
    let action = actions.get(record.toolCallId);
    if (action && action.actionId !== record.actionId)
      invalid('Multiple actions claim one tool call');
    if (!action) {
      action = {
        actionId: record.actionId,
        intent: false,
        dispatched: false,
        effectStarted: false,
        waits: [],
      };
      actions.set(record.toolCallId, action);
    }
    if (action.result) invalid('Tool action continued after settlement');
    if (record.kind === 'tool-intent') {
      if (action.intent || action.dispatched || action.effectStarted)
        invalid('Out-of-order action intent');
      if (
        recoveryValueKey(JSON.parse(call.function.arguments)) !==
        recoveryValueKey(record.parameters)
      )
        invalid('Action arguments differ from saved intent');
      action.intent = true;
    } else if (record.kind === 'tool-dispatch') {
      if (!action.intent || action.dispatched || action.effectStarted)
        invalid('Out-of-order dispatch');
      action.dispatched = true;
    } else if (record.kind === 'tool-effect-start') {
      if (!action.dispatched || action.effectStarted) invalid('Out-of-order effect admission');
      if (action.waits.some((wait) => !wait.response))
        invalid('Tool effect precedes a required response');
      action.effectStarted = true;
    } else if (record.kind === 'tool-wait') {
      if (!action.dispatched || action.effectStarted)
        invalid('Tool wait is outside pre-effect dispatch');
      action.waits.push({
        request: {
          ...record.request,
          executionId,
          actionId: record.actionId,
          parentCallId: record.parentCallId,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
        },
      });
    } else if (record.kind === 'tool-response') {
      const wait = action.waits.find(
        (entry) => entry.request.requestId === record.response.requestId,
      );
      if (!wait || wait.response || action.effectStarted) invalid('Out-of-order tool response');
      wait.response = record.response;
    } else if (record.kind === 'tool-result') {
      const result = record.result;
      if (
        (!action.intent && result.metadata?.errorCode !== ARGUMENT_DECODE_ERROR_CODE) ||
        result.executionId !== call.id ||
        result.toolName !== call.function.name ||
        typeof result.success !== 'boolean' ||
        (result.success && (!action.effectStarted || result.result === undefined)) ||
        (!result.success && !nonempty(result.error))
      )
        invalid('Invalid tool result linkage or payload');
      if (
        record.loadedDeferredTools !== undefined &&
        (!Array.isArray(record.loadedDeferredTools) ||
          record.loadedDeferredTools.some((name) => !nonempty(name)))
      )
        invalid('Invalid tool residency settlement');
      action.result = result;
      action.loadedDeferredTools = record.loadedDeferredTools;
    } else invalid('Unknown action record');
  }
  const checkpoint = request?.checkpoint ?? cachedCheckpoint;
  if (
    !response ||
    !checkpoint ||
    checkpoint.version !== 1 ||
    checkpoint.effectAdmission !== 'required'
  ) {
    invalid('A supported effect-admission checkpoint is required');
  }
  if (
    !Number.isSafeInteger(checkpoint.round) ||
    checkpoint.round < 1 ||
    !Number.isFinite(checkpoint.contextLimit) ||
    checkpoint.contextLimit <= 0 ||
    !Number.isFinite(checkpoint.cumulativeInputTokens) ||
    checkpoint.cumulativeInputTokens < 0 ||
    !Array.isArray(checkpoint.messages) ||
    !Array.isArray(checkpoint.sameToolInputCounts)
  )
    invalid('Invalid round checkpoint');
  const ids = new Set<string>();
  for (const message of checkpoint.messages) {
    if (ids.has(message.id)) invalid('Duplicate checkpoint message identity');
    ids.add(message.id);
  }
  for (const message of [...checkpoint.messages, response]) {
    if (
      !nonempty(message.id) ||
      !(message.timestamp instanceof Date) ||
      !Number.isFinite(message.timestamp.getTime()) ||
      (message.role === 'assistant'
        ? message.content !== null && typeof message.content !== 'string'
        : typeof message.content !== 'string') ||
      (message.role === 'tool' && !nonempty(message.toolCallId)) ||
      !['user', 'assistant', 'system', 'tool'].includes(message.role) ||
      !['complete', 'interrupted'].includes(message.state)
    )
      invalid('Invalid checkpoint message');
  }
  const counts = new Set<string>();
  for (const [key, value] of checkpoint.sameToolInputCounts) {
    if (!nonempty(key) || counts.has(key) || !Number.isSafeInteger(value) || value < 0)
      invalid('Invalid repeated-input checkpoint');
    counts.add(key);
  }
  if (
    checkpoint.maxSameToolInputs !== undefined &&
    (!Number.isSafeInteger(checkpoint.maxSameToolInputs) || checkpoint.maxSameToolInputs < 1)
  )
    invalid('Invalid repeated-input limit');
  if (requireTools && (!Array.isArray(response.toolCalls) || response.toolCalls.length === 0))
    invalid('Saved response has no tool calls');
  ids.clear();
  for (const call of response.toolCalls ?? []) {
    if (
      !nonempty(call.id) ||
      ids.has(call.id) ||
      call.type !== 'function' ||
      !nonempty(call.function?.name) ||
      typeof call.function.arguments !== 'string'
    )
      invalid('Invalid or duplicate saved tool call');
    ids.add(call.id);
  }
  if (request?.options.toolChoice === 'none' && (response.toolCalls?.length ?? 0) > 0)
    invalid('Saved invocation prohibited tool execution');
  const uncertain = [...actions.values()].filter(
    (action) => action.effectStarted && !action.result,
  );
  if (uncertain.length)
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_REQUIRED',
      'Tool effects have no durable result; reconcile them before resuming',
      uncertain.map((action) => action.actionId),
    );
  return {
    checkpoint,
    response,
    actions,
    offeredDeferredTools:
      request?.options.tools?.filter((tool) => tool.deferLoading).map((tool) => tool.name) ?? [],
  };
}
