/**
 * Session history operations — compaction and persistence helpers.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * Each function receives its dependencies explicitly.
 */

import { runHooks, createLogger } from '@robota-sdk/agent-core';

import type { CompactionOrchestrator } from './compaction-orchestrator.js';
import type { ContextWindowTracker } from './context-window-tracker.js';
import type { TSessionLogData } from './session-logger.js';
import type { ICompactEvent, TCompactTrigger } from './session-types.js';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  TSessionLoadOutcome,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

const logger = createLogger('SessionHistoryOps');

/** Dependencies for compact() */
export interface ICompactContext {
  sessionId: string;
  cwd: string;
  systemMessage: string;
  agent: Robota;
  aiProvider: IAIProvider;
  compactionOrchestrator: CompactionOrchestrator;
  contextTracker: ContextWindowTracker;
  hooks: Record<string, unknown> | undefined;
  hookTypeExecutors: IHookTypeExecutor[] | undefined;
  onCompactCallback: ((summary: string) => void) | undefined;
  onCompactEventCallback: ((event: ICompactEvent) => void) | undefined;
  trigger: TCompactTrigger;
  log: (event: string, data: TSessionLogData) => void;
}

/** What compaction needs beyond the run context it shares eight fields with. */
export interface ICompactExtras {
  systemMessage: string;
  compactionOrchestrator: CompactionOrchestrator;
  onCompactCallback: ((summary: string) => void) | undefined;
  onCompactEventCallback: ((event: ICompactEvent) => void) | undefined;
  trigger: TCompactTrigger;
}

/**
 * Assemble the compaction context from the run context plus the five fields only it needs.
 *
 * The eight shared fields were written out twice in `Session`, once per context — the duplication
 * this module is the natural owner of, since it is the one that consumes the result.
 */
export function buildCompactContext(
  run: Omit<ICompactContext, keyof ICompactExtras>,
  extras: ICompactExtras,
): ICompactContext {
  return { ...run, ...extras };
}

/**
 * Summarize the conversation to free context space.
 *
 * @param instructions - Optional focus instructions for the summary
 * @param ctx - Session state and callbacks
 * @param signal - The turn's cancellation signal (RUNTIME-004). When it aborts the orchestrator
 *   THROWS, so this propagates and the history replacement below is never reached — the conversation
 *   is append-only source data and a cancel must not replace it with a summary the user asked not to
 *   produce. The error is an `AbortError`, which `isAbortFailure` already classifies as the user's
 *   own cancellation rather than a failed turn.
 */
export async function compact(
  instructions: string | undefined,
  ctx: ICompactContext,
  signal?: AbortSignal,
): Promise<void> {
  // RUNTIME-004: before the CORE-031 guard, so a cancelled turn is reported as cancelled whether or
  // not there was anything to compact. The orchestrator used to make this check for us, and the early
  // return below would otherwise resolve an aborted compaction quietly — a narrower abort contract
  // ("rejects if cancelled AND there was work") for no gain over the one already in force.
  signal?.throwIfAborted();

  const history = ctx.agent.getHistory();

  // Exclude system messages from compaction — they are preserved and re-injected after
  const nonSystemHistory = history.filter((msg) => msg.role !== 'system');
  // CORE-031: guard on what will actually be compacted, not on the full history. Guarding on
  // `history` and then compacting `nonSystemHistory` let a system-messages-only conversation through
  // — a fresh session before its first turn holds exactly that — and the replacement below wrote an
  // empty `[Context Summary]` over it. There is nothing to summarise here, and nothing to summarise
  // is a no-op, not a failure: the conversation is left exactly as it was found.
  if (nonSystemHistory.length === 0) return;

  ctx.contextTracker.updateFromHistory(history);
  const before = ctx.contextTracker.getContextState();

  // RUNTIME-004: the orchestrator throws if the turn was cancelled, so the history replacement below
  // is not reached — the same guarantee CORE-019 gives for an invalid summary.
  const summary = await ctx.compactionOrchestrator.compact(
    ctx.aiProvider,
    nonSystemHistory,
    instructions,
    signal,
    ctx.trigger,
  );

  // Clear history, re-inject system message, then inject summary.
  // System message must persist across compactions — it contains project context
  // (cwd, AGENTS.md, CLAUDE.md) that the AI needs for every response.
  ctx.agent.clearHistory();
  ctx.agent.injectMessage('system', ctx.systemMessage);
  ctx.agent.injectMessage('assistant', `[Context Summary]\n${summary}`);

  // Reset token tracking based on the new shorter history
  ctx.contextTracker.updateFromHistory(ctx.agent.getHistory());

  // Fire PostCompact hook after history replacement is complete
  const postHookInput: IHookInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: 'PostCompact',
    trigger: ctx.trigger,
    compact_summary: summary,
  };
  runHooks(
    ctx.hooks as THooksConfig | undefined,
    'PostCompact',
    postHookInput,
    ctx.hookTypeExecutors,
  ).catch((error) => logger.warn('hook failed', { error }));

  // Notify via callback after compaction is fully complete
  const after = ctx.contextTracker.getContextState();
  ctx.log('context_compact', {
    trigger: ctx.trigger,
    before,
    after,
  });
  ctx.onCompactEventCallback?.({ trigger: ctx.trigger, before, after });
  if (ctx.onCompactCallback) {
    ctx.onCompactCallback(summary);
  }
}

/** Dependencies for persistSession() */
export interface IPersistContext {
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  toolSchemas: IToolSchema[];
  sessionStore: IInteractiveSessionStore;
  agent: Robota;
  getFullHistory: () => Array<{
    id: string;
    timestamp: Date;
    category: string;
    type: string;
    data?: unknown;
  }>;
}

/**
 * Persist the current session to the store.
 *
 * ## Why this can decline to write (TRANS-007)
 *
 * The existing record is read to preserve the members this function does not own. When `load`
 * answered `undefined` for both "no record" and "the file is damaged", the spread contributed
 * nothing in the damaged case and this function OVERWROTE a recoverable file with a fresh, nearly
 * empty one — on the next autosave, which is however long the user keeps typing.
 *
 * So a non-`valid` load is no longer treated as "no prior record". `missing` is the only outcome
 * that legitimately means there is nothing to preserve; `corrupt` and `unsupported` mean there IS
 * something and this build cannot read it, and writing over it destroys the only copy.
 *
 * Returning silently is deliberate over throwing: this runs on an autosave path, and turning a
 * damaged file into a crashed session helps nobody. The outcome is reported to the caller so a
 * surface can say something; the guarantee this function makes is that it does not destroy.
 */
export function persistSession(ctx: IPersistContext): TSessionLoadOutcome {
  const history = ctx.agent.getHistory();
  const now = new Date().toISOString();

  const outcome = ctx.sessionStore.load(ctx.sessionId);
  if (outcome.status !== 'valid' && outcome.status !== 'missing') {
    return outcome;
  }
  const existing = outcome.status === 'valid' ? outcome.record : undefined;

  const record: IInteractiveSessionRecord = {
    ...existing,
    id: ctx.sessionId,
    name: existing?.name,
    cwd: ctx.cwd,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: history,
    history: ctx.getFullHistory(),
    systemPrompt: ctx.systemPrompt,
    toolSchemas: ctx.toolSchemas,
  };

  ctx.sessionStore.save(record);
  return { status: 'valid', record };
}
