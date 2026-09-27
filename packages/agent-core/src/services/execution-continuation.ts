import type { IAgentConfig } from '../interfaces/agent';
import type {
  IExecutionContinuationState,
  IResumeExecutionOptions,
} from '../interfaces/execution-journal';
import type { ConversationStore } from '../managers/conversation-history-manager';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { createAbortError } from '../utils/abort-classification';
import { buildFinalResult } from './execution-failure';
import { runExecutionLoop, type IExecutionRoundDeps } from './execution-pipeline';
import { recoverToolBatch, recoveryValueKey } from './execution-recovery-state';
import { restoreJournaledRound } from './execution-resume';
import { buildFullExecutionContext } from './execution-service-helpers';
import type { ICoreExecutionResult, IResolvedProviderInfo } from './execution-types';

function invalid(message: string): never {
  throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', message);
}
function validateContinuation(
  value: IExecutionContinuationState | undefined,
): IExecutionContinuationState {
  if (
    !value ||
    value.version !== 1 ||
    !['round', 'summary'].includes(value.kind) ||
    typeof value.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    typeof value.turnMessageId !== 'string' ||
    value.turnMessageId.length === 0 ||
    !value.model ||
    typeof value.model.provider !== 'string' ||
    typeof value.model.model !== 'string' ||
    !value.model.provider ||
    !value.model.model ||
    !value.options ||
    !Number.isSafeInteger(value.options.maxExecutionRounds) ||
    value.options.maxExecutionRounds! < 0 ||
    !Array.isArray(value.toolsExecuted) ||
    value.toolsExecuted.some((name) => typeof name !== 'string') ||
    !Number.isSafeInteger(value.consecutiveUnknownToolFailureRounds) ||
    value.consecutiveUnknownToolFailureRounds < 0 ||
    !Array.isArray(value.loadedDeferredTools) ||
    value.loadedDeferredTools.some((name) => typeof name !== 'string' || !name) ||
    typeof value.structuredOutput !== 'boolean' ||
    typeof value.options.allowToolOnlyCompletion !== 'boolean' ||
    typeof value.options.withholdHostedTools !== 'boolean'
  )
    invalid('Unsupported runtime continuation checkpoint');
  if (value.structuredOutput)
    invalid('Structured-output validators do not yet support execution continuation');
  return value;
}

/** Continue the logical execution from its latest settled response, without submitting a user input. */
export async function continueJournaledExecution(
  store: ConversationStore,
  conversationId: string,
  options: IResumeExecutionOptions,
  currentConfig: IAgentConfig,
  resolve: (config: IAgentConfig) => IResolvedProviderInfo,
  deps: IExecutionRoundDeps,
): Promise<ICoreExecutionResult> {
  const before = recoveryValueKey(store.getMessages());
  const records = await options.journal.read(options.executionId);
  options.signal?.throwIfAborted();
  const invocation = records.findLast(
    (record) => record.kind === 'model-request' || record.kind === 'model-cache-hit',
  );
  if (!invocation || !('callId' in invocation)) invalid('No recoverable model invocation exists');
  if (
    invocation.kind === 'model-request' &&
    !records.some(
      (record) => record.kind === 'model-response' && record.callId === invocation.callId,
    )
  ) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_REQUIRED',
      'The latest model invocation has no durable response; reconcile it before resuming',
    );
  }
  const batch = recoverToolBatch(records, options.executionId, invocation.callId, false);
  const saved = validateContinuation(batch.checkpoint.continuation);
  if (
    saved.model.provider !== currentConfig.defaultModel.provider ||
    saved.model.model !== currentConfig.defaultModel.model
  ) {
    invalid('Active provider and model must match the saved runtime before continuation');
  }
  const turn = batch.checkpoint.messages.find((message) => message.id === saved.turnMessageId);
  if (!turn || turn.role !== 'user' || turn.metadata?.executionId !== options.executionId)
    invalid('Continuation has no matching original input');
  if ((saved.toolSearch ?? 'auto') !== (currentConfig.toolSearch ?? 'auto'))
    invalid('Tool residency policy differs from the saved runtime');
  if (currentConfig.responseFormat && currentConfig.responseFormat.type !== 'text')
    invalid('Current runtime requires an unsupported structured-output validator');
  if (saved.options.maxSameToolInputs !== batch.checkpoint.maxSameToolInputs)
    invalid('Conflicting repeated-input limits');
  if (saved.kind === 'summary' && (batch.response.toolCalls?.length ?? 0) > 0)
    invalid('Terminal summary cannot dispatch tools');
  for (const action of batch.actions.values()) {
    if (action.result && action.loadedDeferredTools === undefined)
      invalid('Settled action lacks runtime residency state');
  }
  const config: IAgentConfig = {
    ...currentConfig,
    defaultModel: structuredClone(saved.model),
    timeout: saved.timeout,
    maxExecutionRounds: saved.options.maxExecutionRounds,
    maxSameToolInputs: saved.options.maxSameToolInputs,
  };
  const resolved = resolve(config);
  if (resolved.currentInfo.provider !== saved.model.provider)
    invalid('Active provider manager differs from the saved runtime');
  if (before !== recoveryValueKey(store.getMessages())) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_CONFLICT',
      'History changed while reading the execution journal',
    );
  }
  const restored = await restoreJournaledRound(
    store,
    conversationId,
    { ...options, callId: invocation.callId },
    deps,
    { batch, records },
  );
  const context = buildFullExecutionContext(
    store.getMessages(),
    config,
    new Date(saved.startedAt),
    options.executionId,
    conversationId,
    {
      ...saved.options,
      signal: options.signal,
      executionJournal: options.journal,
      onTextDelta: options.onTextDelta,
      onExecutionEvent: options.onExecutionEvent,
      traceContext: options.traceContext,
    },
  );
  deps.eventEmitter.prepareOwnerPathBases(conversationId);
  try {
    // Recovered provider/tool/lifecycle hooks are not replayed. Newly dispatched rounds use the normal pipeline.
    await runExecutionLoop(
      store,
      conversationId,
      options.executionId,
      context,
      config,
      resolved,
      restored.state,
      options.signal,
      deps,
      restored.stop || saved.kind === 'summary',
    );
    if (options.signal?.aborted)
      throw createAbortError('Execution continuation interrupted', options.signal.reason);
    return buildFinalResult(
      store,
      options.executionId,
      context.startTime,
      restored.state.toolsExecuted,
      {
        turnMessageId: saved.turnMessageId,
        allowToolOnlyCompletion: saved.options.allowToolOnlyCompletion,
      },
      restored.state.providerFailure,
    );
  } finally {
    deps.eventEmitter.clearToolEventServices();
    deps.eventEmitter.resetOwnerPathBases();
  }
}
