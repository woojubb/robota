import { EXECUTION_EVENTS } from './execution-constants';
import { createManagedToolExecutor } from './execution-managed-host';
import { finalizeExecution } from './execution-pipeline';
import { initializeConversationStore } from './execution-service-helpers';
import { userMessageMetadata } from './execution-user-message';
import { callPluginHook, type TPluginWithHooks } from './plugin-hook-dispatcher';
import type { ToolExecutionService } from './tool-execution-service';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { ExecutionSuspendedError } from '../utils/execution-suspended-error';
import { isExecutionControlError } from '../utils/execution-control-error';
import type { TAgentExecutionConfig } from '../interfaces/agent';
import type { IRecoverableExecutionJournal } from '../interfaces/execution-journal';
import type {
  IManagedRunProvider,
  IManagedTurnInput,
  TManagedTurnEvent,
  TManagedTurnResult,
} from '../interfaces/managed-provider';
import type { IToolManager } from '../interfaces/manager';
import type { TUniversalMessage } from '../interfaces/messages';
import type { ITokenUsage } from '../interfaces/provider';
import type { TMetadata } from '../interfaces/types';
import type { ConversationHistory } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type {
  ICoreExecutionResult,
  IExecutionContext,
  IExecutionRoundState,
} from './execution-types';

function unavailable(message: string): ExecutionRecoveryError {
  return new ExecutionRecoveryError('EXECUTION_RECOVERY_REQUIRED', message);
}

function readableJournal(context: IExecutionContext): IRecoverableExecutionJournal {
  const journal = context.executionJournal;
  if (!journal || !('read' in journal) || typeof journal.read !== 'function')
    throw unavailable('Managed execution requires a readable host journal');
  return journal as IRecoverableExecutionJournal;
}

export function assertManagedRunPreflight(
  messages: readonly TUniversalMessage[],
  context: Partial<IExecutionContext>,
  config: TAgentExecutionConfig,
): void {
  if (!context.managedTurn || !context.sessionId || !context.signal)
    throw unavailable('Managed execution requires an active Session turn');
  context.managedTurn.assertActive();
  context.signal.throwIfAborted();
  if (context.managedTurn.binding.sessionId !== context.sessionId)
    throw unavailable('Managed connection binding belongs to a different Session');
  if (messages.length > 0) context.managedTurn.assertHistory(messages);
  if (
    messages.some((message) => message.role !== 'system') &&
    context.managedTurn.binding.revision === 0
  )
    throw unavailable('Managed continuation requires a verified conversation binding');
  const toolChoice = context.toolChoice ?? config.defaultModel.toolChoice;
  if (toolChoice !== undefined && toolChoice !== 'auto')
    throw unavailable('Managed execution cannot enforce this tool choice');
  if (
    context.withholdHostedTools ||
    (config.responseFormat && config.responseFormat.type !== 'text')
  )
    throw unavailable('Managed execution cannot enforce this provider capability');
  if (
    context.ephemeralSystemContext ||
    context.traceContext ||
    context.maxTokens !== undefined ||
    config.defaultModel.maxTokens !== undefined ||
    context.temperature !== undefined ||
    config.defaultModel.temperature !== undefined ||
    config.defaultModel.topP !== undefined ||
    config.defaultModel.effort !== undefined ||
    config.timeout !== undefined ||
    config.retryAttempts !== undefined ||
    (context.maxExecutionRounds ?? config.maxExecutionRounds ?? 0) !== 0
  )
    throw unavailable('Managed execution cannot enforce these request limits or context options');
}

function captureFinal(value: TManagedTurnResult): { id: string; content: string; timestamp: Date } {
  let frame: TManagedTurnResult;
  try {
    frame = structuredClone(value);
  } catch {
    throw unavailable('Managed final frame cannot be captured');
  }
  if (
    !frame ||
    typeof frame !== 'object' ||
    Array.isArray(frame) ||
    Object.getPrototypeOf(frame) !== Object.prototype ||
    Object.keys(frame).some(
      (key) => !['id', 'role', 'content', 'timestamp', 'state'].includes(key),
    ) ||
    frame.role !== 'assistant' ||
    typeof frame.id !== 'string' ||
    frame.id.length === 0 ||
    typeof frame.content !== 'string' ||
    frame.content.trim().length === 0 ||
    !(frame.timestamp instanceof Date) ||
    !Number.isFinite(frame.timestamp.getTime()) ||
    frame.state !== 'complete'
  )
    throw unavailable('Managed provider returned an invalid final frame');
  return { id: frame.id, content: frame.content, timestamp: frame.timestamp };
}

function checkedUsage(value: ITokenUsage): ITokenUsage {
  const usage = structuredClone(value);
  if (
    !usage ||
    typeof usage !== 'object' ||
    Array.isArray(usage) ||
    Object.keys(usage).some(
      (key) => !['promptTokens', 'completionTokens', 'totalTokens'].includes(key),
    ) ||
    !Number.isSafeInteger(usage.promptTokens) ||
    usage.promptTokens < 0 ||
    !Number.isSafeInteger(usage.completionTokens) ||
    usage.completionTokens < 0 ||
    usage.totalTokens !== usage.promptTokens + usage.completionTokens
  )
    throw unavailable('Managed provider emitted invalid usage');
  return usage;
}

/** Execute a fresh managed turn under the Session claim and its recoverable host journal. */
export async function executeManagedRun(input: {
  input: string;
  messages: TUniversalMessage[];
  config: TAgentExecutionConfig;
  context: IExecutionContext;
  provider: IManagedRunProvider;
  selected: { provider: string; model: string };
  conversationHistory: ConversationHistory;
  tools: IToolManager;
  toolExecutionService: ToolExecutionService;
  plugins: TPluginWithHooks[];
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
}): Promise<ICoreExecutionResult> {
  const {
    context,
    config,
    provider,
    selected,
    conversationHistory,
    tools,
    toolExecutionService,
    plugins,
    logger,
    eventEmitter,
  } = input;
  const conversationId = context.conversationId!;
  const executionId = context.executionId;
  const journal = readableJournal(context);
  assertManagedRunPreflight(input.messages, context, config);
  if (
    selected.provider !== config.defaultModel.provider ||
    selected.model !== config.defaultModel.model ||
    provider.name !== selected.provider
  )
    throw unavailable('Managed provider selection conflicts with the agent configuration');
  if (!provider.validateConfig()) throw unavailable('Managed provider configuration is invalid');
  const prior = await journal.read(executionId);
  if (prior.length > 0) throw unavailable('Managed execution ID already has journal records');
  context.managedTurn!.assertActive();

  const projectedTools = structuredClone(tools.getOfferedTools());
  if (projectedTools.length !== tools.getTools().length)
    throw unavailable('Managed execution cannot continue with a deferred tool projection');
  for (const tool of projectedTools) {
    if (!tool.description) throw unavailable(`Managed tool ${tool.name} has no description`);
  }
  const store = initializeConversationStore(
    conversationHistory,
    conversationId,
    input.messages,
    config,
    executionId,
  );
  if (
    store.getMessages().some((message) => message.role !== 'system') &&
    context.managedTurn!.binding.revision === 0
  )
    throw unavailable('Managed continuation requires a verified conversation binding');

  eventEmitter.emitExecution(
    EXECUTION_EVENTS.START,
    {
      parameters: { input: input.input, provider: provider.name, model: selected.model },
      metadata: { method: 'execute', messageCount: input.messages.length },
    },
    conversationId,
    executionId,
  );

  const roundState: IExecutionRoundState = {
    toolsExecuted: [],
    toolCallOutcomes: [],
    currentRound: 0,
    runningAssistantCount: 0,
    lastTrackedAssistantMessage: undefined,
    cumulativeInputTokens: 0,
    consecutiveUnknownToolFailureRounds: 0,
    sameToolInputCounts: new Map(),
  };
  let turnMessageId: string | undefined;
  let executor: ReturnType<typeof createManagedToolExecutor> | undefined;
  try {
    const index = store.getMessages().length;
    store.addUserMessage(
      input.input,
      userMessageMetadata(executionId, context.driverId, context.turnSource),
    );
    const userMessage = store.getMessages().at(-1)!;
    turnMessageId = userMessage.id;
    context.onExecutionEvent?.('history_mutation', {
      executionId,
      conversationId,
      mutation: 'append_message',
      index,
      message: userMessage,
    });
    eventEmitter.emitUserMessageEvent(input.input, conversationId, executionId);
    await callPluginHook(
      plugins,
      'beforeRun',
      {
        input: input.input,
        ...(context.metadata ? { metadata: context.metadata as TMetadata } : {}),
      },
      logger,
    );
    await callPluginHook(
      plugins,
      'onMessageAdded',
      { message: userMessage, executionContext: { executionId, conversationId } },
      logger,
    );
    for (const hookName of ['beforeExecution', 'beforeConversation'] as const)
      await callPluginHook(
        plugins,
        hookName,
        { messages: store.getMessages(), executionContext: { executionId, conversationId } },
        logger,
      );

    context.managedTurn!.assertActive();
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal!, controller.signal]);
    const currentExecutor = createManagedToolExecutor({
      journal,
      store,
      conversationId,
      context: { ...context, signal },
      config,
      tools: projectedTools,
      state: roundState,
      deps: { toolExecutionService, plugins, logger, eventEmitter },
      usageEventsOnly: true,
      earlierFrameIds: context.managedTurn!.binding.frameIds,
    });
    executor = currentExecutor;
    let hostFailure: unknown;
    let hostFailed = false;
    let closed = false;
    let usage: ITokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const usageByFrame = new Map<string, ITokenUsage>();
    const latch = (error: unknown): void => {
      if (!hostFailed) {
        hostFailed = true;
        hostFailure = error;
      }
      controller.abort(hostFailure);
    };
    const assertOpen = (): void => {
      if (hostFailed) throw hostFailure;
      if (closed) throw unavailable('Managed turn has ended');
      context.managedTurn!.assertActive();
      signal.throwIfAborted();
    };
    const emit = async (event: TManagedTurnEvent): Promise<void> => {
      try {
        assertOpen();
        const saved = structuredClone(event);
        if (!saved || typeof saved.frameId !== 'string' || saved.frameId.length === 0)
          throw unavailable('Managed provider emitted an invalid frame event');
        if ((saved as { kind: string }).kind === 'text-delta')
          throw unavailable('Managed text streaming requires interrupted-frame persistence');
        else if (saved.kind === 'thinking-delta' && typeof saved.text === 'string')
          context.onThinkingDelta?.(saved.text);
        else if (saved.kind === 'usage') {
          const value = checkedUsage(saved.usage);
          const previous = usageByFrame.get(saved.frameId);
          if (previous) {
            if (
              previous.promptTokens !== value.promptTokens ||
              previous.completionTokens !== value.completionTokens ||
              previous.totalTokens !== value.totalTokens
            )
              throw unavailable('Managed frame usage changed after settlement');
            return;
          }
          usageByFrame.set(saved.frameId, value);
          usage = {
            promptTokens: usage.promptTokens + value.promptTokens,
            completionTokens: usage.completionTokens + value.completionTokens,
            totalTokens: usage.totalTokens + value.totalTokens,
          };
          if (
            !Number.isSafeInteger(usage.promptTokens) ||
            !Number.isSafeInteger(usage.completionTokens) ||
            !Number.isSafeInteger(usage.totalTokens)
          )
            throw unavailable('Managed provider usage exceeded the supported range');
        } else throw unavailable('Managed provider emitted an invalid frame event');
      } catch (error) {
        latch(error);
        throw error;
      }
    };
    const providerInput: IManagedTurnInput = structuredClone({
      messages: store.getMessages(),
      tools: projectedTools,
      model: selected.model,
      binding: context.managedTurn!.binding,
      options: { executionId },
    });
    let result: TManagedTurnResult | undefined;
    let runFailure: unknown;
    let runFailed = false;
    let closeFailure: unknown;
    let closeFailed = false;
    try {
      await callPluginHook(
        plugins,
        'beforeProviderCall',
        { messages: store.getMessages() },
        logger,
      );
      result = await provider.run(providerInput, {
        signal,
        emit,
        execute: (frame) => {
          try {
            assertOpen();
            return currentExecutor.execute(frame).catch((error: unknown) => {
              latch(error);
              throw error;
            });
          } catch (error) {
            latch(error);
            return Promise.reject(error);
          }
        },
      });
      currentExecutor.assertHealthy();
    } catch (error) {
      runFailure = error;
      runFailed = true;
    } finally {
      closed = true;
      try {
        await currentExecutor.close();
      } catch (error) {
        closeFailure = error;
        closeFailed = true;
      }
    }
    if (closeFailed) {
      const closeWasAbort =
        typeof closeFailure === 'object' &&
        closeFailure !== null &&
        'name' in closeFailure &&
        closeFailure.name === 'AbortError';
      if (hostFailed && closeWasAbort) throw hostFailure;
      throw closeFailure;
    }
    if (hostFailed) throw hostFailure;
    if (runFailed) throw runFailure;
    assertManagedRunPreflight([], context, config);
    const final = captureFinal(result!);
    const committed = await journal.read(executionId);
    assertManagedRunPreflight([], context, config);
    if (
      store.getMessages().some((message) => message.id === final.id) ||
      committed.some((record) => record.kind === 'managed-frame' && record.response.id === final.id)
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'Managed final frame reused a committed message identity',
      );
    const indexBeforeFinal = store.getMessages().length;
    store.addMessage({
      ...final,
      role: 'assistant',
      state: 'complete',
      metadata: {
        executionId,
        providerId: provider.name,
        modelId: selected.model,
        ...(usage.totalTokens > 0 && {
          usage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          },
        }),
      },
    });
    const savedFinal = store.getMessages().at(-1)!;
    context.onExecutionEvent?.('history_mutation', {
      executionId,
      conversationId,
      mutation: 'append_message',
      index: indexBeforeFinal,
      message: savedFinal,
    });
    context.onExecutionEvent?.('assistant_message_committed', {
      executionId,
      conversationId,
      round: currentExecutor.getState().currentRound + 1,
      message: savedFinal,
    });
    await callPluginHook(
      plugins,
      'afterProviderCall',
      { messages: store.getMessages(), responseMessage: savedFinal },
      logger,
    );
    await callPluginHook(plugins, 'onMessageAdded', { message: savedFinal }, logger);
    return finalizeExecution(
      input.input,
      store,
      executionId,
      context.startTime,
      currentExecutor.getState(),
      conversationId,
      turnMessageId,
      false,
      context,
      plugins,
      logger,
      eventEmitter,
    );
  } catch (error) {
    if (error instanceof ExecutionSuspendedError)
      throw unavailable('Managed approval waiting requires a verified native continuation');
    if (isExecutionControlError(error)) throw error;
    return {
      response: '',
      messages: store.getMessages(),
      executionId,
      duration: Date.now() - context.startTime.getTime(),
      toolsExecuted: executor?.getState().toolsExecuted ?? roundState.toolsExecuted,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
