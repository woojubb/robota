import { applyToolOutcome } from './execution-tool-outcome';
import type {
  IResumeToolCallsOptions,
  IResumeToolCallsResult,
  TExecutionJournalRecord,
} from '../interfaces/execution-journal';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IManagedToolReceipt } from '../interfaces/managed-provider';
import type { TAgentExecutionConfig } from '../interfaces/agent';
import { ConversationStore } from '../managers/conversation-history-manager';
import { createAbortError } from '../utils/abort-classification';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isJsonEqual } from '../utils/json-equal';
import { isUniversalValueEqual } from '../utils/universal-value-equal';
import {
  recoverToolBatch,
  recoveryValueKey,
  type IRecoveredToolBatch,
} from './execution-recovery-state';
import { collectCommittedUsageMetadata } from './execution-usage';
import { addToolResultsToHistory } from './execution-round-tool-results';
import { executeAndRecordToolCalls } from './execution-round-tools';
import { sameReceiptMetadata } from './execution-receipt-frame';
import type { IRoundDependencies } from './execution-round-types';
import type { IExecutionRoundState } from './execution-types';
import { acceptToolResponses } from './execution-tool-waits';

function conflict(message: string): never {
  throw new ExecutionRecoveryError('EXECUTION_RECOVERY_CONFLICT', message);
}

function recoveredAssistant(
  batch: IRecoveredToolBatch,
  options: IResumeToolCallsOptions,
): TUniversalMessage {
  return {
    ...structuredClone(batch.response),
    // Provider message IDs may repeat after reopening a client; the journal call owns this commit.
    id: `recovery:${options.executionId}:${options.callId}:assistant`,
    ...(batch.checkpoint.continuation?.kind === 'summary' && {
      content:
        batch.response.content ||
        'Maximum rounds reached. Partial results available in conversation history.',
      toolCalls: [],
    }),
    metadata: {
      ...batch.response.metadata,
      ...collectCommittedUsageMetadata(batch.response),
      executionId: options.executionId,
      providerCallId: options.callId,
      round: batch.checkpoint.round,
    },
  };
}

function matchesAssistant(
  actual: TUniversalMessage,
  expected: TUniversalMessage,
  callId: string,
  executionId: string,
): boolean {
  return (
    actual.role === 'assistant' &&
    expected.role === 'assistant' &&
    (actual.content ?? '') === (expected.content ?? '') &&
    recoveryValueKey(actual.toolCalls ?? []) === recoveryValueKey(expected.toolCalls ?? []) &&
    actual.metadata?.providerCallId === callId &&
    actual.metadata.executionId === executionId
  );
}

/** Message IDs and timestamps are regenerated on recovery; the model-visible data is not. */
function matchesReceiptHistory(
  actual: TUniversalMessage,
  expected: TUniversalMessage,
  assistant: boolean,
): boolean {
  const { id: _actualId, timestamp: _actualTime, metadata: actualMetadata, ...actualData } = actual;
  const {
    id: _expectedId,
    timestamp: _expectedTime,
    metadata: expectedMetadata,
    ...expectedData
  } = expected;
  void _actualId;
  void _actualTime;
  void _expectedId;
  void _expectedTime;
  const ownerFields = new Set([
    'executionId',
    'providerCallId',
    'providerId',
    'modelId',
    'round',
    'usageObservationId',
  ]);
  const semanticMetadata = (metadata: TUniversalMessage['metadata']) =>
    Object.fromEntries(
      Object.entries(metadata ?? {}).filter(([key]) => !assistant || !ownerFields.has(key)),
    );
  const normalize = (data: typeof actualData) =>
    assistant && data.role === 'assistant' ? { ...data, content: data.content ?? '' } : data;
  return (
    isJsonEqual(normalize(actualData), normalize(expectedData)) &&
    sameReceiptMetadata(semanticMetadata(actualMetadata), semanticMetadata(expectedMetadata))
  );
}

/** Provider metadata cannot be treated as host-added merely because its key is also host-owned. */
function matchesSavedProviderMetadata(
  actual: TUniversalMessage,
  batch: IRecoveredToolBatch,
): boolean {
  const saved = batch.response.metadata;
  if (!saved) return true;
  if (!actual.metadata) return false;
  return Object.keys(saved).every(
    (key) =>
      Object.hasOwn(actual.metadata!, key) &&
      sameReceiptMetadata({ [key]: actual.metadata![key] }, { [key]: saved[key] }),
  );
}

/** Verify the saved prefix and any already-published, settled tool-result prefix before effects. */
function validateHistory(
  existing: TUniversalMessage[],
  batch: IRecoveredToolBatch,
  options: IResumeToolCallsOptions,
  deps: IRoundDependencies,
): void {
  if (!existing.length) return;
  const base = batch.checkpoint.messages;
  const prefix = existing.slice(0, base.length);
  const matchesPrefix = options.includeReceipts
    ? isUniversalValueEqual(prefix, base)
    : recoveryValueKey(prefix) === recoveryValueKey(base);
  if (existing.length < base.length || !matchesPrefix) {
    conflict('Current history differs from the saved runtime checkpoint');
  }
  const suffix = existing.slice(base.length);
  if (!suffix.length) return;
  if (
    !matchesAssistant(
      suffix[0],
      recoveredAssistant(batch, options),
      options.callId,
      options.executionId,
    )
  )
    conflict('Current assistant does not match the saved response');
  if (
    options.includeReceipts &&
    (!matchesReceiptHistory(suffix[0], recoveredAssistant(batch, options), true) ||
      !matchesSavedProviderMetadata(suffix[0], batch))
  )
    conflict('Current assistant frame differs from the durable response');
  const calls = batch.response.toolCalls ?? [];
  if (suffix.length > calls.length + 1)
    conflict('History has advanced beyond the recovered tool batch');
  const prefixCalls = calls.slice(0, suffix.length - 1);
  const results = prefixCalls.map((call) => {
    const result = batch.actions.get(call.id)?.result;
    if (!result) conflict('History contains a tool result without durable settlement');
    return result;
  });
  const formatted = new ConversationStore();
  for (const message of base) formatted.addMessage(message);
  formatted.addMessage(suffix[0]);
  addToolResultsToHistory(
    prefixCalls,
    { results, errors: [] },
    formatted,
    batch.checkpoint.round,
    deps.logger,
    {
      contextLimit: batch.checkpoint.contextLimit,
      cumulativeInputTokens: recoveredInputTokens(batch),
    },
  );
  for (let index = 1; index < suffix.length; index++) {
    const expected = formatted.getMessages()[base.length + index];
    const actual = suffix[index];
    if (
      actual.role !== 'tool' ||
      expected.role !== 'tool' ||
      actual.toolCallId !== expected.toolCallId ||
      actual.name !== expected.name ||
      actual.content !== expected.content ||
      (options.includeReceipts && !matchesReceiptHistory(actual, expected, false))
    )
      conflict('Existing tool result conflicts with the durable result');
  }
}

function recoveredInputTokens(batch: IRecoveredToolBatch): number {
  const observed = collectCommittedUsageMetadata(batch.response).inputTokens ?? 0;
  return observed > 0 ? observed : batch.checkpoint.cumulativeInputTokens;
}

export interface IRestoredExecutionRound extends IResumeToolCallsResult {
  batch: IRecoveredToolBatch;
  state: IExecutionRoundState;
  stop: boolean;
}

/** Restore a settled model round without invoking a provider or replaying completed-boundary hooks. */
export async function restoreJournaledRound(
  store: ConversationStore,
  conversationId: string,
  options: IResumeToolCallsOptions,
  deps: IRoundDependencies,
  prepared?: { batch: IRecoveredToolBatch; records: readonly TExecutionJournalRecord[] },
  config?: TAgentExecutionConfig,
): Promise<IRestoredExecutionRound> {
  const before = recoveryValueKey(store.getMessages());
  const beforeReceiptHistory = options.includeReceipts
    ? structuredClone(store.getMessages())
    : undefined;
  const unchanged = (): void => {
    if (
      (beforeReceiptHistory
        ? !isUniversalValueEqual(beforeReceiptHistory, store.getMessages())
        : before !== recoveryValueKey(store.getMessages())) ||
      store.hasPendingAssistant()
    )
      conflict('History changed during execution recovery');
  };
  unchanged();
  const records = prepared?.records ?? (await options.journal.read(options.executionId));
  let batch = prepared?.batch ?? recoverToolBatch(records, options.executionId, options.callId);
  options.signal?.throwIfAborted();
  unchanged();
  if (
    options.includeReceipts &&
    !matchesSavedProviderMetadata(recoveredAssistant(batch, options), batch)
  )
    conflict('Saved provider metadata conflicts with the recovered assistant frame');
  const existing = structuredClone(store.getMessages());
  validateHistory(existing, batch, options, deps);
  const accepted = await acceptToolResponses(records, options);
  if (accepted.length !== records.length)
    batch = recoverToolBatch(accepted, options.executionId, options.callId, false);
  options.signal?.throwIfAborted();
  unchanged();
  const loaded = new Set([
    ...(batch.checkpoint.continuation?.loadedDeferredTools ?? []),
    ...batch.offeredDeferredTools,
  ]);
  for (const action of batch.actions.values())
    for (const name of action.loadedDeferredTools ?? []) loaded.add(name);
  deps.toolExecutionService.restoreLoadedDeferredTools([...loaded]);
  const staged = new ConversationStore();
  for (const message of batch.checkpoint.messages) staged.addMessage(structuredClone(message));
  const isSummary = batch.checkpoint.continuation?.kind === 'summary';
  const calls = batch.response.toolCalls ?? [];
  const hasResponse =
    isSummary || calls.length > 0 || (batch.response.content?.trim().length ?? 0) > 0;
  if (hasResponse) staged.addMessage(recoveredAssistant(batch, options));
  const state: IExecutionRoundState = {
    toolsExecuted: [...(batch.checkpoint.continuation?.toolsExecuted ?? [])],
    toolCallOutcomes: [],
    currentRound: batch.checkpoint.round,
    runningAssistantCount: staged.getMessages().filter((message) => message.role === 'assistant')
      .length,
    lastTrackedAssistantMessage: batch.response,
    cumulativeInputTokens: recoveredInputTokens(batch),
    consecutiveUnknownToolFailureRounds:
      batch.checkpoint.continuation?.consecutiveUnknownToolFailureRounds ?? 0,
    forcedSummaryInstruction: batch.checkpoint.continuation?.forcedSummaryInstruction,
    sameToolInputCounts: new Map(batch.checkpoint.sameToolInputCounts),
  };
  deps.eventEmitter.prepareOwnerPathBases(conversationId);
  try {
    let stop = calls.length === 0;
    let receipts: readonly IManagedToolReceipt[] | undefined;
    if (calls.length > 0) {
      const outcome = await executeAndRecordToolCalls(
        calls,
        staged,
        conversationId,
        options.executionId,
        batch.checkpoint.round,
        options.callId,
        undefined,
        state,
        deps,
        config && { ...config, maxSameToolInputs: batch.checkpoint.maxSameToolInputs },
        options.signal,
        undefined,
        batch.checkpoint.maxSameToolInputs,
        undefined,
        {
          journal: options.journal,
          parentCallId: options.callId,
          recovery: batch,
          ...(options.includeReceipts && { captureReceipts: true, assistantFrame: batch.response }),
        },
      );
      if (options.includeReceipts && !outcome.receipts)
        conflict('The recovered batch does not have a complete set of durable receipts');
      receipts = outcome.receipts;
      stop = applyToolOutcome(outcome, state, deps.logger);
    }
    unchanged();
    // An observer failure must not strand half of the checkpoint in the live store.
    for (const message of staged.getMessages().slice(existing.length)) store.addMessage(message);
    const committed = structuredClone(store.getMessages());
    const committedKey = recoveryValueKey(committed);
    const receiptCommitted = options.includeReceipts ? structuredClone(committed) : undefined;
    for (let index = existing.length; index < committed.length; index++) {
      options.onExecutionEvent?.('history_mutation', {
        executionId: options.executionId,
        conversationId,
        round: batch.checkpoint.round,
        mutation: 'append_message',
        index,
        message: committed[index],
      });
      if (
        (receiptCommitted
          ? !isUniversalValueEqual(receiptCommitted, store.getMessages())
          : committedKey !== recoveryValueKey(store.getMessages())) ||
        store.hasPendingAssistant()
      )
        conflict('History changed while announcing execution recovery');
    }
    if (options.signal?.aborted)
      throw createAbortError('Execution recovery interrupted', options.signal.reason);
    return {
      executionId: options.executionId,
      callId: options.callId,
      messages: structuredClone(store.getMessages()),
      ...(receipts && { receipts }),
      batch,
      state,
      stop,
    };
  } finally {
    deps.eventEmitter.clearToolEventServices();
    deps.eventEmitter.resetOwnerPathBases();
  }
}

/** Provider-free public batch operation; internal counters remain owned by the runtime. */
export async function resumeJournaledToolCalls(
  store: ConversationStore,
  conversationId: string,
  options: IResumeToolCallsOptions,
  deps: IRoundDependencies,
  config: TAgentExecutionConfig,
): Promise<IResumeToolCallsResult> {
  const { executionId, callId, messages, receipts } = await restoreJournaledRound(
    store,
    conversationId,
    options,
    deps,
    undefined,
    config,
  );
  return { executionId, callId, messages, ...(receipts && { receipts }) };
}
