/**
 * Session run — core execution logic for a single agent turn.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * Stateless: all mutable state is passed in via IRunContext.
 */

import {
  CONTEXT_ESTIMATE_CHARS_PER_TOKEN,
  createLogger,
  createUserMessage,
  getProviderCapabilities,
  runHooks,
  traceEnvFor,
} from '@robota-sdk/agent-core';

import { perTurnRunOptions } from './session-run-options.js';
import { createRunObservers } from './session-run-observation.js';

import type { IRunContext } from './session-run-context.js';
export type { IRunContext } from './session-run-context.js';
import type { ISessionRunOptions } from './session-types.js';
import type { THooksConfig } from '@robota-sdk/agent-core';

const logger = createLogger('SessionRun');

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
      if (runOptions?.executionJournal) {
        await ctx.compact(abortSignal, hookTraceEnv, runOptions.executionJournal);
      } else {
        await (hookTraceEnv ? ctx.compact(abortSignal, hookTraceEnv) : ctx.compact(abortSignal));
      }
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
    response = await ctx.agent.run(enrichedMessage, {
      signal: abortSignal,
      maxExecutionRounds: ctx.maxTurns ?? 0,
      // Thin pass-through of the per-turn options to agent-core (SELFHOST-008 P3, PEER-007).
      ...perTurnRunOptions(runOptions),
      ...createRunObservers(ctx, traceContext),
    });

    // If execution was interrupted (abort fired during execution),
    // throw AbortError so the caller (useSubmitHandler) shows "Cancelled."
    if (abortSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  } catch (error) {
    try {
      ctx.log('error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? '') : '',
        historyLength: ctx.agent.getHistory().length,
      });
    } catch {
      // Diagnostic failure cannot replace the execution error and its recovery classification.
    }
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
