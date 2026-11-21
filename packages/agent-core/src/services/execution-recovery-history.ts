import type { IResumeToolCallsOptions } from '../interfaces/execution-journal';
import type { TUniversalMessage } from '../interfaces/messages';
import { ConversationStore } from '../managers/conversation-store';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isJsonEqual } from '../utils/json-equal';
import { isUniversalValueEqual } from '../utils/universal-value-equal';
import { SilentLogger } from '../utils/logger';
import { recoveryValueKey, type IRecoveredToolBatch } from './execution-recovery-state';
import { sameReceiptMetadata } from '../utils/receipt-metadata';
import { addToolResultsToHistory } from './execution-round-tool-results';
import { collectCommittedUsageMetadata } from './execution-usage';

export function recoveredAssistant(
  batch: IRecoveredToolBatch,
  options: Pick<IResumeToolCallsOptions, 'executionId' | 'callId'>,
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

export function matchesAssistant(
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
export function matchesReceiptHistory(
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
export function matchesSavedProviderMetadata(
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

export function recoveredInputTokens(batch: IRecoveredToolBatch): number {
  const observed = collectCommittedUsageMetadata(batch.response).inputTokens ?? 0;
  return observed > 0 ? observed : batch.checkpoint.cumulativeInputTokens;
}

/** A managed frame cannot advance past a settled batch while dropping its committed transcript. */
export function assertManagedFrameHistory(
  previous: IRecoveredToolBatch,
  nextMessages: readonly TUniversalMessage[],
): void {
  const base = previous.checkpoint.messages;
  const calls = previous.response.toolCalls ?? [];
  if (
    nextMessages.length !== base.length + calls.length + 1 ||
    !isUniversalValueEqual(nextMessages.slice(0, base.length), base)
  )
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_CONFLICT',
      'Managed frame checkpoint does not extend the saved history',
    );
  const store = new ConversationStore();
  for (const message of base) store.addMessage(structuredClone(message));
  store.addMessage(recoveredAssistant(previous, previous));
  addToolResultsToHistory(
    calls,
    { results: calls.map((call) => previous.actions.get(call.id)!.result!), errors: [] },
    store,
    previous.checkpoint.round,
    SilentLogger,
    {
      contextLimit: previous.checkpoint.contextLimit,
      cumulativeInputTokens: recoveredInputTokens(previous),
    },
  );
  const expected = store.getMessages();
  for (let index = base.length; index < expected.length; index++) {
    const actual = nextMessages[index];
    const settled = expected[index];
    const assistant = index === base.length;
    if (
      !matchesReceiptHistory(actual, settled, assistant) ||
      (assistant &&
        (actual.id !== settled.id ||
          !matchesAssistant(actual, settled, previous.callId, previous.executionId) ||
          !matchesSavedProviderMetadata(actual, previous)))
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'Managed frame checkpoint differs from the settled history',
      );
  }
}
