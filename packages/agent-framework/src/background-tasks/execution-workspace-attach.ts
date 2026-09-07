/**
 * CLI-1994: whether an execution-workspace entry can be ATTACHED to, and what attaching produces.
 *
 * Beside `execution-workspace-projection.ts` deliberately: that module decides when the `attach`
 * control is OFFERED, and this one decides when it is HONOURED. Two modules answering those two
 * questions from two different tables is how a surface ends up offering a control that always
 * refuses — so both live with the projection that owns the entry.
 *
 * Attaching is a VIEW SWITCH, never a merge. The outcome carries the forked session's id and the
 * surface points its channel at that record; the parent's record is not read, written or joined.
 * The refusals are explicit, and each names the reason a reader can act on:
 *
 *   - the entry is not a fork (no `resumeSessionId`) — there is no second session to switch to;
 *   - the task reached a terminal status — its session is finished, so attaching would open a
 *     transcript that cannot be continued as a live session;
 *   - the record is gone from the store — the copy was deleted, and a surface that switched anyway
 *     would open an empty session that looks like a fork whose conversation was lost.
 */

import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-executor';

import type { IExecutionWorkspaceEntry } from './execution-workspace-types.js';

/** What the surface does next: switch its view, or say why it will not. */
export type TExecutionAttachOutcome =
  | { readonly type: 'switch-session'; readonly sessionId: string }
  | { readonly type: 'refused'; readonly reason: string };

export interface IResolveExecutionAttachInput {
  /**
   * Whether the forked session's record is still in the store the surface would switch onto.
   *
   * A predicate rather than the store itself: the caller is a renderer, and the only fact it needs
   * is presence. Passing the store would let a surface load and re-render a conversation the
   * session layer owns.
   */
  readonly hasSessionRecord: (sessionId: string) => boolean;
}

/**
 * `TExecutionWorkspaceStatus` is `'active' | 'idle' | TBackgroundTaskStatus`, so excluding the two
 * main-thread members NARROWS the rest to a task status — no assertion, and a member added to
 * either union lands in the branch that is right for it rather than being cast into the other one.
 */
function isTerminalEntryStatus(status: IExecutionWorkspaceEntry['status']): boolean {
  if (status === 'active' || status === 'idle') return false;
  return isTerminalBackgroundTaskStatus(status);
}

export function resolveExecutionAttach(
  entry: IExecutionWorkspaceEntry,
  input: IResolveExecutionAttachInput,
): TExecutionAttachOutcome {
  const sessionId = entry.resumeSessionId;
  if (sessionId === undefined) {
    return {
      type: 'refused',
      reason: `${entry.title} is not a forked session; nothing to attach to.`,
    };
  }
  if (isTerminalEntryStatus(entry.status)) {
    return {
      type: 'refused',
      reason:
        `${entry.title} is ${entry.status}; attach follows a fork that is still running. ` +
        `Its record is still there — open it with: robota --resume ${sessionId}`,
    };
  }
  if (!input.hasSessionRecord(sessionId)) {
    return {
      type: 'refused',
      reason: `The forked session ${sessionId} is no longer in the session store (${entry.status}).`,
    };
  }
  return { type: 'switch-session', sessionId };
}
