/**
 * Session run — core execution logic for a single agent turn.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * Stateless: all mutable state is passed in via IRunContext.
 */

import {
  CONTEXT_ESTIMATE_CHARS_PER_TOKEN,
  PROVIDER_CALL_EVENTS,
  createLogger,
  createUserMessage,
  getProviderCapabilities,
  isModelEffort,
  runHooks,
  traceEnvFor,
} from '@robota-sdk/agent-core';

import { perTurnRunOptions } from './session-run-options.js';
import {
  createToolExecutionBridge,
  forwardToolExecutionEvent,
} from './session-tool-execution-bridge.js';

import type { ContextWindowTracker } from './context-window-tracker.js';
import type { TSessionLogData } from './session-logger.js';
import type {
  IProviderCallTraceObservation,
  ISessionOptions,
  ISessionRunOptions,
} from './session-types.js';
import type {
  IAIProvider,
  IContextWindowState,
  THooksConfig,
  IHookTypeExecutor,
  ISubprocessTraceEnv,
  TTextDeltaCallback,
  TModelEffortSelection,
} from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';

const logger = createLogger('SessionRun');

/**
 * SELFHOST-009: fire an INFORMATIONAL-ONLY model-call hook event mapped from a provider-call
 * execution event the turn owner already observes. Fire-and-forget — `onExecutionEvent` is a void,
 * un-awaited callback, so this `runHooks` call cannot block or mutate `provider.chat()`. Its result
 * is never consulted for gating; only PreToolUse gates.
 */
function fireModelCallHook(
  ctx: IRunContext,
  hookEvent: 'PreModelCall' | 'PostModelCall',
  data: Record<string, unknown>,
  hookTraceEnv: ISubprocessTraceEnv | undefined,
): void {
  const model = typeof data['model'] === 'string' ? (data['model'] as string) : ctx.model;
  const provider =
    typeof data['provider'] === 'string' ? (data['provider'] as string) : ctx.aiProvider.name;
  const rawEffort = data['effort'];
  const effort =
    typeof rawEffort === 'string' && isModelEffort(rawEffort)
      ? rawEffort
      : (ctx.effort ??
        (typeof ctx.agent.getModel === 'function' ? ctx.agent.getModel().effort : undefined) ??
        'high');
  const round = typeof data['round'] === 'number' ? (data['round'] as number) : undefined;
  void runHooks(
    ctx.hooks as THooksConfig | undefined,
    hookEvent,
    {
      session_id: ctx.sessionId,
      cwd: ctx.cwd,
      hook_event_name: hookEvent,
      model,
      provider,
      effort,
      ...(round !== undefined && { round }),
      ...(ctx.permissionMode !== undefined && { permission_mode: ctx.permissionMode }),
      ...(ctx.transcriptPath !== undefined && { transcript_path: ctx.transcriptPath }),
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
    hookTraceEnv,
  ).catch((error) => logger.warn('hook failed', { error }));
}

/** Dependencies injected by Session.run() */
export interface IRunContext {
  sessionId: string;
  cwd: string;
  model: string;
  /** Model-effort selection for informational model-call hooks. */
  effort?: TModelEffortSelection;
  /** Current permission mode — passed to all hook inputs as permission_mode */
  permissionMode?: string;
  /** Absolute path to session transcript file — passed to all hook inputs as transcript_path */
  transcriptPath?: string;
  agent: Robota;
  aiProvider: IAIProvider;
  contextTracker: ContextWindowTracker;
  hooks: Record<string, unknown> | undefined;
  hookTypeExecutors: IHookTypeExecutor[] | undefined;
  sessionStartStdout: string;
  log: (event: string, data: TSessionLogData) => void;
  /** RUNTIME-004: abort must not rewrite history. `hookTraceEnv` is the prompt's, for PreCompact. */
  compact: (signal?: AbortSignal, hookTraceEnv?: ISubprocessTraceEnv) => Promise<void>;
  persistSession: () => void;
  getSessionStore: () => boolean;
  clearSessionStartStdout: () => void;
  maxTurns?: number;
  onTextDelta?: TTextDeltaCallback;
  onContextUpdate?: (state: IContextWindowState) => void;
  onToolExecution?: ISessionOptions['onToolExecution'];
  emitProviderCallCompleted?: (observation: IProviderCallTraceObservation) => void;
  knownToolNames?: readonly string[];
}

/**
 * Execute a single agent turn: run hooks, send message to AI, log results.
 *
 * @param message - The processed message to send to the AI
 * @param rawInput - Optional raw user input (used for hook prompt field)
 * @param ctx - Session state and callbacks
 * @param abortSignal - AbortSignal from the session's AbortController
 */
export async function executeRun(
  message: string,
  rawInput: string | undefined,
  ctx: IRunContext,
  abortSignal: AbortSignal,
  runOptions?: ISessionRunOptions,
): Promise<string> {
  // Command hooks fired on this prompt's path name its root span; hooks elsewhere get nothing.
  const traceContext = runOptions?.traceContext;
  const hookTraceEnv = traceContext
    ? traceEnvFor('hooks', traceContext, traceContext.parentSpanId)
    : undefined;
  // Auto-compact BEFORE processing the new message (not after).
  // This prevents compaction from interfering with the current response stream.
  ctx.contextTracker.updateFromHistory(ctx.agent.getHistory());
  if (ctx.contextTracker.shouldAutoCompact()) {
    // Providers store onTextDelta as an instance property for their own internal streaming.
    // Compaction calls provider.chat() without passing onTextDelta in options, so the
    // provider falls back to this.onTextDelta. Temporarily clearing it prevents compaction
    // summary text from streaming to the UI. This workaround stays until provider packages
    // remove the instance-level onTextDelta property.
    const provider = ctx.aiProvider as { onTextDelta?: unknown };
    const savedDelta = provider.onTextDelta;
    provider.onTextDelta = undefined;
    try {
      await (hookTraceEnv ? ctx.compact(abortSignal, hookTraceEnv) : ctx.compact(abortSignal));
    } finally {
      provider.onTextDelta = savedDelta;
    }
  }

  ctx.log('user', { content: message });

  // Fire UserPromptSubmit hook before AI processes input
  const hookResult = await runHooks(
    ctx.hooks as THooksConfig | undefined,
    'UserPromptSubmit',
    {
      session_id: ctx.sessionId,
      cwd: ctx.cwd,
      hook_event_name: 'UserPromptSubmit',
      user_message: rawInput ?? message,
      prompt: rawInput ?? message,
      ...(ctx.permissionMode !== undefined && { permission_mode: ctx.permissionMode }),
      ...(ctx.transcriptPath !== undefined && { transcript_path: ctx.transcriptPath }),
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
    hookTraceEnv,
  );

  // Inject hook stdout into user message (e.g., plugin path info)
  const hookStdout = [ctx.sessionStartStdout, hookResult.stdout].filter(Boolean).join('\n');
  const enrichedMessage = hookStdout
    ? `<system-reminder>\n${hookStdout}\n</system-reminder>\n${message}`
    : message;
  // Clear sessionStart stdout after first injection
  ctx.clearSessionStartStdout();

  const history = ctx.agent.getHistory();
  const historyJson = JSON.stringify(history);
  const providerCapabilities = getProviderCapabilities(ctx.aiProvider);
  ctx.log('pre_run', {
    historyLength: history.length,
    historyChars: historyJson.length,
    historyEstTokens: Math.ceil(historyJson.length / CONTEXT_ESTIMATE_CHARS_PER_TOKEN),
    input: enrichedMessage,
    history,
    model: ctx.model,
    provider: ctx.aiProvider.name,
    maxTokens: ctx.contextTracker.getContextState().maxTokens,
    nativeWebSearchSupported: providerCapabilities.nativeWebTools.webSearch.supported,
    nativeWebSearchEnabled: providerCapabilities.nativeWebTools.webSearch.enabled,
    nativeWebFetchSupported: providerCapabilities.nativeWebTools.webFetch.supported,
    nativeWebFetchEnabled: providerCapabilities.nativeWebTools.webFetch.enabled,
  });
  ctx.contextTracker.updateFromHistory([...history, createUserMessage(enrichedMessage)]);
  ctx.onContextUpdate?.(ctx.contextTracker.getContextState());

  let response: string;
  try {
    const toolExecutionBridge = createToolExecutionBridge({
      knownToolNames: ctx.knownToolNames ?? [],
      ...(ctx.onToolExecution && { onToolExecution: ctx.onToolExecution }),
    });
    const onTextDelta = ctx.onTextDelta
      ? (delta: string): void => {
          ctx.log('text_delta', { delta });
          ctx.onTextDelta?.(delta);
        }
      : undefined;

    response = await ctx.agent.run(enrichedMessage, {
      signal: abortSignal,
      maxExecutionRounds: ctx.maxTurns ?? 0,
      // Thin pass-through of the per-turn options to agent-core (SELFHOST-008 P3, PEER-007).
      ...perTurnRunOptions(runOptions),
      onExecutionEvent: (event, data) => {
        // This new local observability signal is persisted by the interactive history owner;
        // it is not a replay-substrate session-log event.
        if (event !== PROVIDER_CALL_EVENTS.COMPLETED) ctx.log(event, data as TSessionLogData);
        forwardToolExecutionEvent(toolExecutionBridge, event, data);
        // SELFHOST-009: fire the informational-only model-call events from the provider-call
        // execution events the turn owner already observes. provider_request → PreModelCall (before
        // provider.chat() returns); provider_response_normalized → PostModelCall (the SINGLE
        // canonical source — NOT provider_response_raw, which would double-fire per round). Both are
        // fire-and-forget: this callback is void/un-awaited, so they cannot gate/mutate the call.
        if (event === 'provider_request') {
          fireModelCallHook(ctx, 'PreModelCall', data as Record<string, unknown>, hookTraceEnv);
        } else if (event === 'provider_response_normalized') {
          fireModelCallHook(ctx, 'PostModelCall', data as Record<string, unknown>, hookTraceEnv);
        } else if (event === PROVIDER_CALL_EVENTS.COMPLETED && ctx.emitProviderCallCompleted) {
          // Forward an allowlist, not the generic event envelope, across the session boundary.
          const observation = data as Record<string, unknown>;
          if (
            Number.isSafeInteger(observation['round']) &&
            (observation['round'] as number) > 0 &&
            typeof observation['startedAt'] === 'string' &&
            typeof observation['endedAt'] === 'string' &&
            (observation['outcome'] === 'success' ||
              observation['outcome'] === 'failure' ||
              observation['outcome'] === 'interrupted')
          ) {
            ctx.emitProviderCallCompleted({
              round: observation['round'] as number,
              startedAt: observation['startedAt'],
              endedAt: observation['endedAt'],
              outcome: observation['outcome'],
              ...(typeof observation['callId'] === 'string' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                  observation['callId'],
                ) && { callId: observation['callId'] }),
              ...((observation['disposition'] === 'invoked' ||
                observation['disposition'] === 'cache-hit' ||
                observation['disposition'] === 'preflight-refused') && {
                disposition: observation['disposition'],
              }),
              ...(typeof observation['providerId'] === 'string' &&
                observation['providerId'].length > 0 &&
                observation['providerId'].length <= 128 &&
                [...observation['providerId']].every((char) => char.charCodeAt(0) >= 32) && {
                  providerId: observation['providerId'],
                }),
              ...(typeof observation['modelId'] === 'string' &&
                observation['modelId'].length > 0 &&
                observation['modelId'].length <= 128 &&
                [...observation['modelId']].every((char) => char.charCodeAt(0) >= 32) && {
                  modelId: observation['modelId'],
                }),
              ...((observation['usageProvenance'] === 'complete' ||
                observation['usageProvenance'] === 'partial' ||
                observation['usageProvenance'] === 'absent') && {
                usageProvenance: observation['usageProvenance'],
              }),
              ...(observation['usageProvenance'] === 'complete' &&
                typeof observation['promptTokens'] === 'number' &&
                Number.isSafeInteger(observation['promptTokens']) &&
                observation['promptTokens'] >= 0 &&
                typeof observation['completionTokens'] === 'number' &&
                Number.isSafeInteger(observation['completionTokens']) &&
                observation['completionTokens'] >= 0 &&
                typeof observation['totalTokens'] === 'number' &&
                Number.isSafeInteger(observation['totalTokens']) &&
                observation['totalTokens'] ===
                  observation['promptTokens'] + observation['completionTokens'] && {
                  promptTokens: observation['promptTokens'],
                  completionTokens: observation['completionTokens'],
                  totalTokens: observation['totalTokens'],
                }),
              ...(observation['disposition'] === 'invoked' &&
                typeof observation['providerRequestId'] === 'string' && {
                  providerRequestId: observation['providerRequestId'],
                }),
            });
          }
        }
        // BEHAVIOR-002: recompute and emit context per agentic round so the status bar
        // climbs live during a turn instead of jumping once at completion. The agent loop
        // runs entirely inside this single robota.run() call; assistant_message_committed
        // fires once per round with the round's usage already committed to history, which is
        // the right cadence — frequent enough to feel live, sparse enough to avoid render flooding.
        if (event === 'assistant_message_committed') {
          ctx.contextTracker.updateFromHistory(ctx.agent.getHistory());
          ctx.onContextUpdate?.(ctx.contextTracker.getContextState());
        }
      },
      ...(onTextDelta && { onTextDelta }),
    });

    // If execution was interrupted (abort fired during execution),
    // throw AbortError so the caller (useSubmitHandler) shows "Cancelled."
    if (abortSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  } catch (error) {
    ctx.log('error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? '') : '',
      historyLength: ctx.agent.getHistory().length,
    });
    runHooks(
      ctx.hooks as THooksConfig | undefined,
      'StopFailure',
      {
        session_id: ctx.sessionId,
        cwd: ctx.cwd,
        hook_event_name: 'StopFailure',
        reason: error instanceof Error ? error.message : String(error),
        stop_hook_active: false,
        ...(ctx.permissionMode !== undefined && { permission_mode: ctx.permissionMode }),
        ...(ctx.transcriptPath !== undefined && { transcript_path: ctx.transcriptPath }),
        env: {
          CLAUDE_PROJECT_DIR: ctx.cwd,
          CLAUDE_SESSION_ID: ctx.sessionId,
        },
      },
      ctx.hookTypeExecutors,
      hookTraceEnv,
    ).catch((error) => logger.warn('hook failed', { error }));
    throw error;
  }

  // Log the response and full history structure
  const postHistory = ctx.agent.getHistory();
  const historyStructure = postHistory.map((msg) => {
    const hasToolCalls =
      'toolCalls' in msg && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
    const toolCallNames = hasToolCalls
      ? (msg.toolCalls as Array<{ function: { name: string } }>).map((tc) => tc.function.name)
      : [];
    return {
      role: msg.role,
      contentLength: typeof msg.content === 'string' ? msg.content.length : 0,
      hasToolCalls,
      toolCallNames,
      ...(msg.metadata ? { metadata: msg.metadata } : {}),
    };
  });
  ctx.log('assistant', {
    content: response,
    historyLength: postHistory.length,
    estimatedChars: JSON.stringify(postHistory).length,
    history: postHistory,
    historyStructure,
  });

  // Update token usage from the latest assistant message metadata
  ctx.contextTracker.updateFromHistory(postHistory);

  const ctxState = ctx.contextTracker.getContextState();
  ctx.onContextUpdate?.(ctxState);
  ctx.log('context', {
    maxTokens: ctxState.maxTokens,
    usedTokens: ctxState.usedTokens,
    usedPercentage: ctxState.usedPercentage,
    remainingPercentage: ctxState.remainingPercentage,
  });

  // Fire Stop hook after AI response is complete (informational, fire and forget)
  runHooks(
    ctx.hooks as THooksConfig | undefined,
    'Stop',
    {
      session_id: ctx.sessionId,
      cwd: ctx.cwd,
      hook_event_name: 'Stop',
      response: response.substring(0, 500),
      last_assistant_message: response,
      stop_hook_active: false,
      ...(ctx.permissionMode !== undefined && { permission_mode: ctx.permissionMode }),
      ...(ctx.transcriptPath !== undefined && { transcript_path: ctx.transcriptPath }),
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
    hookTraceEnv,
  ).catch((error) => logger.warn('hook failed', { error }));

  if (ctx.getSessionStore()) {
    ctx.persistSession();
  }

  return response;
}
