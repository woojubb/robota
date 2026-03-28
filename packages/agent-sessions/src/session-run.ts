/**
 * Session run — core execution logic for a single agent turn.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * Stateless: all mutable state is passed in via IRunContext.
 */

import { runHooks } from '@robota-sdk/agent-core';
import type { IAIProvider, THooksConfig, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';
import type { ContextWindowTracker } from './context-window-tracker.js';
import type { TSessionLogData } from './session-logger.js';

/** Dependencies injected by Session.run() */
export interface IRunContext {
  sessionId: string;
  cwd: string;
  model: string;
  robota: Robota;
  aiProvider: IAIProvider;
  contextTracker: ContextWindowTracker;
  hooks: Record<string, unknown> | undefined;
  hookTypeExecutors: IHookTypeExecutor[] | undefined;
  sessionStartStdout: string;
  log: (event: string, data: TSessionLogData) => void;
  compact: () => Promise<void>;
  persistSession: () => void;
  getSessionStore: () => boolean;
  clearSessionStartStdout: () => void;
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
): Promise<string> {
  // Auto-compact BEFORE processing the new message (not after).
  // This prevents compaction from interfering with the current response stream.
  ctx.contextTracker.updateFromHistory(ctx.robota.getHistory());
  if (ctx.contextTracker.shouldAutoCompact()) {
    // Temporarily disable onTextDelta to prevent summary text from streaming to UI
    const provider = ctx.aiProvider as { onTextDelta?: unknown };
    const savedDelta = provider.onTextDelta;
    provider.onTextDelta = undefined;
    try {
      await ctx.compact();
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
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
  );

  // Inject hook stdout into user message (e.g., plugin path info)
  const hookStdout = [ctx.sessionStartStdout, hookResult.stdout].filter(Boolean).join('\n');
  const enrichedMessage = hookStdout
    ? `<system-reminder>\n${hookStdout}\n</system-reminder>\n${message}`
    : message;
  // Clear sessionStart stdout after first injection
  ctx.clearSessionStartStdout();

  const history = ctx.robota.getHistory();
  const historyJson = JSON.stringify(history);
  const providerHasWebTools =
    'enableWebTools' in ctx.aiProvider &&
    (ctx.aiProvider as { enableWebTools?: boolean }).enableWebTools === true;
  ctx.log('pre_run', {
    historyLength: history.length,
    historyChars: historyJson.length,
    historyEstTokens: Math.ceil(historyJson.length / 4),
    model: ctx.model,
    provider: ctx.aiProvider.name,
    maxTokens: ctx.contextTracker.getContextState().maxTokens,
    webToolsEnabled: providerHasWebTools,
  });

  let response: string;
  try {
    response = await ctx.robota.run(enrichedMessage, { signal: abortSignal });

    // If execution was interrupted (abort fired during execution),
    // throw AbortError so the caller (useSubmitHandler) shows "Cancelled."
    if (abortSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  } catch (error) {
    ctx.log('error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? '') : '',
      historyLength: ctx.robota.getHistory().length,
    });
    throw error;
  }

  // Log the response and full history structure
  const postHistory = ctx.robota.getHistory();
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
    content: response.substring(0, 500),
    historyLength: postHistory.length,
    estimatedChars: JSON.stringify(postHistory).length,
    historyStructure,
  });

  // Update token usage from the latest assistant message metadata
  ctx.contextTracker.updateFromHistory(postHistory);

  const ctxState = ctx.contextTracker.getContextState();
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
      env: {
        CLAUDE_PROJECT_DIR: ctx.cwd,
        CLAUDE_SESSION_ID: ctx.sessionId,
      },
    },
    ctx.hookTypeExecutors,
  ).catch(() => {});

  if (ctx.getSessionStore()) {
    ctx.persistSession();
  }

  return response;
}
