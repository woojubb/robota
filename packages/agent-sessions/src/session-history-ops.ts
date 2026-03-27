/**
 * Session history operations — compaction and persistence helpers.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * Each function receives its dependencies explicitly.
 */

import { runHooks } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';
import type { SessionStore, ISessionRecord } from './session-store.js';
import type { CompactionOrchestrator } from './compaction-orchestrator.js';
import type { ContextWindowTracker } from './context-window-tracker.js';
import type { TSessionLogData } from './session-logger.js';

/** Dependencies for compact() */
export interface ICompactContext {
  sessionId: string;
  cwd: string;
  systemMessage: string;
  robota: Robota;
  aiProvider: IAIProvider;
  compactionOrchestrator: CompactionOrchestrator;
  contextTracker: ContextWindowTracker;
  hooks: Record<string, unknown> | undefined;
  hookTypeExecutors: IHookTypeExecutor[] | undefined;
  onCompactCallback: ((summary: string) => void) | undefined;
  log: (event: string, data: TSessionLogData) => void;
}

/**
 * Summarize the conversation to free context space.
 *
 * @param instructions - Optional focus instructions for the summary
 * @param ctx - Session state and callbacks
 */
export async function compact(
  instructions: string | undefined,
  ctx: ICompactContext,
): Promise<void> {
  const history = ctx.robota.getHistory();
  if (history.length === 0) return;

  const trigger: 'auto' | 'manual' = instructions !== undefined ? 'manual' : 'auto';

  // Exclude system messages from compaction — they are preserved and re-injected after
  const nonSystemHistory = history.filter((msg) => msg.role !== 'system');
  const summary = await ctx.compactionOrchestrator.compact(
    ctx.aiProvider,
    nonSystemHistory,
    instructions,
  );

  // Clear history, re-inject system message, then inject summary.
  // System message must persist across compactions — it contains project context
  // (cwd, AGENTS.md, CLAUDE.md) that the AI needs for every response.
  ctx.robota.clearHistory();
  ctx.robota.injectMessage('system', ctx.systemMessage);
  ctx.robota.injectMessage('assistant', `[Context Summary]\n${summary}`);

  // Reset token tracking based on the new shorter history
  ctx.contextTracker.updateFromHistory(ctx.robota.getHistory());

  // Fire PostCompact hook after history replacement is complete
  const postHookInput: IHookInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: 'PostCompact',
    trigger,
    compact_summary: summary,
  };
  runHooks(
    ctx.hooks as THooksConfig | undefined,
    'PostCompact',
    postHookInput,
    ctx.hookTypeExecutors,
  ).catch(() => {});

  // Notify via callback after compaction is fully complete
  if (ctx.onCompactCallback) {
    ctx.onCompactCallback(summary);
  }
}

/** Dependencies for persistSession() */
export interface IPersistContext {
  sessionId: string;
  cwd: string;
  sessionStore: SessionStore;
  robota: Robota;
  getFullHistory: () => Array<{
    id: string;
    timestamp: Date;
    category: string;
    type: string;
    data?: unknown;
  }>;
}

/** Persist the current session to the store */
export function persistSession(ctx: IPersistContext): void {
  const history = ctx.robota.getHistory();
  const now = new Date().toISOString();

  const existing = ctx.sessionStore.load(ctx.sessionId);

  const record: ISessionRecord = {
    id: ctx.sessionId,
    name: existing?.name,
    cwd: ctx.cwd,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: history,
    history: ctx.getFullHistory(),
  };

  ctx.sessionStore.save(record);
}
