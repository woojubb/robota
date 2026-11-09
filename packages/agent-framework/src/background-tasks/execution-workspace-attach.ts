/**
 * What attaching to an execution-workspace entry does.
 *
 * Beside `execution-workspace-projection.ts` deliberately: the projection decides when the `attach`
 * control is OFFERED, and this module decides when it is HONOURED. Both read ONE table,
 * {@link attachKind}, so a surface cannot be offered a control that means something else when it is
 * pressed. A fork has two lives, and attaching means a different thing in each:
 *
 *   - the job is still running — FOLLOW it. Nothing switches: the job stays the one writer of its
 *     record, the parent's session is not stopped, and nothing is cancelled. The surface shows the
 *     job's events and steers it with `send`. Following reads no record, so it works with the keys
 *     locked and with no session store at all;
 *   - the job has ended — CONTINUE it: switch the view onto the fork's own record, the ordinary
 *     session switch (a verified record opens, an unverified one asks). A VIEW switch, never a
 *     merge: the parent's record is not read, written or joined.
 *
 * The refusals are explicit, and each names the reason a reader can act on:
 *
 *   - the entry is not a fork (no `resumeSessionId`) — there is no second session to attach to;
 *   - the job ended but its record still has a writer — the job's process may still be closing it, or
 *     another process opened it — so the session continuing would be a second writer of one record;
 *   - the record is gone from the store — the copy was deleted, and a surface that switched anyway
 *     would open an empty session that looks like a fork whose conversation was lost.
 *
 * The offer deliberately does not read the writer: a lease ends without an event, so a writer-
 * dependent offer goes stale exactly when a job ends. The refusal that is left is a few milliseconds
 * long, and it says to retry.
 */

import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-executor';

import type {
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from './execution-workspace-types.js';

/** What the surface does next: follow the job, switch its view, or say why it will not. */
export type TExecutionAttachOutcome =
  | {
      readonly type: 'follow';
      /** The task to follow: the entry's `sourceId`, which `send-background-task` addresses. */
      readonly taskId: string;
      readonly sessionId: string;
    }
  | { readonly type: 'switch-session'; readonly sessionId: string }
  | { readonly type: 'refused'; readonly reason: string; readonly resumeSessionId?: string };

/** What attaching to an entry means, from the entry alone: the table the offer and the honour share. */
export type TExecutionAttachKind = 'follow' | 'continue' | 'none';

/**
 * What a surface that can see the session store knows about the fork's record. A predicate rather
 * than the store itself: the caller is a renderer, and passing the store would let a surface load
 * and re-render a conversation the session layer owns.
 */
export interface IStoreAttachFacts {
  readonly kind: 'store';
  /** Whether the forked session's record is still in the store the surface would switch onto. */
  readonly hasSessionRecord: (sessionId: string) => boolean;
  /**
   * Whether the forked record may have a writer now — the store's own `hasWriter`, which sees a
   * child process it is lent to and another process that opened it.
   */
  readonly hasWriter: (sessionId: string) => boolean;
}

/**
 * A surface with no store (a terminal attached to a host's session): it asks the host to switch, and
 * the host's refusal, in its own words, is the honour of a continue.
 */
export interface IHostAttachFacts {
  readonly kind: 'host';
}

export type TExecutionAttachFacts = IStoreAttachFacts | IHostAttachFacts;

/**
 * `TExecutionWorkspaceStatus` is `'active' | 'idle' | TBackgroundTaskStatus`, so excluding the two
 * main-thread members NARROWS the rest to a task status — no assertion, and a member added to
 * either union lands in the branch that is right for it rather than being cast into the other one.
 */
function isTerminalEntryStatus(status: IExecutionWorkspaceEntry['status']): boolean {
  if (status === 'active' || status === 'idle') return false;
  return isTerminalBackgroundTaskStatus(status);
}

/**
 * What attaching to an entry means: a fork that is still running is followed, one that has ended is
 * continued, anything else has nothing to attach to. Reads only the fields the projection carries, so
 * the projection can ask it before the entry exists.
 */
export function attachKind(
  target: Pick<IExecutionWorkspaceEntry, 'resumeSessionId' | 'status'>,
): TExecutionAttachKind {
  if (target.resumeSessionId === undefined) return 'none';
  return isTerminalEntryStatus(target.status) ? 'continue' : 'follow';
}

/**
 * How many jobs of the session, other than the one being continued, have not ended — the jobs the
 * session left behind by a switch would cancel when it shuts down. Counted from the entries' own
 * statuses with the table the manager's shutdown acts on, so the number a person is told is the
 * number that is stopped.
 */
export function liveBackgroundJobCount(
  snapshot: Pick<IExecutionWorkspaceSnapshot, 'entries'> | null,
  exceptEntryId: string,
): number {
  if (snapshot === null) return 0;
  return snapshot.entries.filter(
    (entry) =>
      entry.kind === 'background_task' &&
      entry.id !== exceptEntryId &&
      !isTerminalEntryStatus(entry.status),
  ).length;
}

export function resolveExecutionAttach(
  entry: IExecutionWorkspaceEntry,
  facts: TExecutionAttachFacts,
): TExecutionAttachOutcome {
  const sessionId = entry.resumeSessionId;
  const kind = attachKind(entry);
  if (sessionId === undefined || kind === 'none') {
    return {
      type: 'refused',
      reason: `${entry.title} is not a forked session; nothing to attach to.`,
    };
  }
  if (kind === 'follow') return { type: 'follow', taskId: entry.sourceId, sessionId };
  if (facts.kind === 'host') return { type: 'switch-session', sessionId };
  if (facts.hasWriter(sessionId)) {
    return {
      type: 'refused',
      reason:
        `${entry.title} has ended, but its session ${sessionId} still has a writer: the job's ` +
        'process may still be closing it, or another process has it open. Try again in a moment.',
    };
  }
  if (!facts.hasSessionRecord(sessionId)) {
    return {
      type: 'refused',
      reason: `The forked session ${sessionId} is no longer in the session store (${entry.status}).`,
    };
  }
  return { type: 'switch-session', sessionId };
}
