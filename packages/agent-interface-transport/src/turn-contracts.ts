/**
 * RUNTIME-003 — the identity of one submission, and the ways it can end.
 *
 * Split out of `session-contracts.ts`, which had grown past its size ratchet: turn identity is its
 * own subject, and the rule is to split rather than extend. Everything here is a TYPE — this package
 * is inert by rule, so the error is declared as a shape and constructed in `@robota-sdk/agent-framework`.
 */

import type { IContextWindowState, IHistoryEntry } from '@robota-sdk/agent-core';

import type { IPromptFileReferenceRecord } from './event-contracts.js';
import type { IToolSummary, IUsageSnapshot } from './session-contracts.js';

/**
 * RUNTIME-003: the identity of one submission, handed back to whoever made it.
 *
 * Without this a subscriber has only the session-global `complete` / `interrupted` / `error` events,
 * which say that A turn ended and never which one. Two callers listening at once are answered by
 * whichever fires first — measured in the MCP adapter, where the second `submit` was handed the
 * running turn's response as its own.
 *
 * `completed` ALWAYS settles, and that is the part worth stating. A session runs one turn at a time
 * and queues the rest, and a queued submission does not always get to run: the co-drive queue
 * coalesces a same-driver entry into the one behind it and drops at capacity. A handle that only
 * settled for submissions that ran would leave the others waiting forever, which is the hang this
 * type exists to make impossible — so a submission that never runs REJECTS with `TurnNotRunError`
 * and says which of those happened.
 */
export interface ITurnHandle {
  /** Minted when the submission is accepted, and kept if it waits in the queue before running. */
  readonly turnId: string;
  /** Resolves with THIS submission's result; rejects with `TurnNotRunError` if it never ran. */
  readonly completed: Promise<IExecutionResult>;
}

/** Why a submission never became a turn. */
export type TTurnNotRunReason =
  /** A later same-driver input replaced it in the queue (tail-coalesce). */
  | 'coalesced'
  /** The queue was at capacity when it arrived. */
  | 'dropped'
  /**
   * The queue was cleared before it ran — abort, cancel, or session shutdown.
   *
   * A separate `'shutdown'` member was declared here and never produced: shutdown clears the queue
   * through the same `clearPendingQueue`, so every entry it discards is already reported as
   * cancelled. Review found it, and a vocabulary member no code path can emit is a promise to the
   * consumer that nothing keeps — it would have them writing a branch that never runs.
   */
  | 'cancelled';

/**
 * The error a rejected `ITurnHandle.completed` carries.
 *
 * Declared as a SHAPE here and constructed in `@robota-sdk/agent-framework`, because an interface
 * package is inert by rule — no classes, no runtime dependency edges. A consumer narrows on `name`
 * and reads `reason`; it does not need the constructor to do that.
 */
export interface ITurnNotRunError extends Error {
  readonly name: 'TurnNotRunError';
  readonly turnId: string;
  readonly reason: TTurnNotRunReason;
}

/** Result of a completed prompt execution. */
export interface IExecutionResult {
  response: string;
  history: IHistoryEntry[];
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
  usage?: IUsageSnapshot;
  promptFileReferences?: IPromptFileReferenceRecord[];
}
