/**
 * The TUI half of `attach` — turning the workspace entry the operator picked into
 * a followed job, a session switch, or a stated refusal.
 *
 * The DECISION is not made here. `resolveExecutionAttach` is the framework's, beside the projection
 * that decides when the control is offered, so the surface cannot invent a second answer to "what
 * does attaching to this do". What this module owns is the surface's part: the refusal reaches the
 * operator as a message, following selects the job's entry, and a switch goes through the SAME
 * session-switch path the session picker uses — a new channel from the factory, the previous one
 * stopped first.
 *
 * A switch is a VIEW change. Nothing is merged: the parent session's record is not read or written,
 * and the two records stay separate exactly as `/fork` left them. Following changes nothing at all:
 * the job keeps running, and the parent session is not stopped.
 */

import { resolveExecutionAttach } from '@robota-sdk/agent-framework';

import type { TExecutionAttachFacts } from '@robota-sdk/agent-framework';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface/execution';

/**
 * What an attach did: followed a running job, or pointed this terminal at the fork's session.
 *
 * Deliberately NOT a `TCommandUiIntent` member. Attach starts at a keypress in this surface's own
 * background panel, not at a command, so routing it through the requester-routed intent bus would
 * add a hop with no second consumer at the end of it — and the intent's `useSideEffects` case had no
 * emitter, which is a reader with no writer.
 */
export type TForkAttachOutcome =
  | { readonly type: 'follow'; readonly taskId: string }
  | { readonly type: 'switch'; readonly sessionId: string };

export interface IForkAttachDeps {
  /** What this surface knows about the fork's record: the store's answers, or the host's to give. */
  readonly facts: TExecutionAttachFacts;
  /** Watch the running job in this terminal: the entry's own view, where the composer steers it. */
  readonly followTask: (entry: IExecutionWorkspaceEntry) => void;
  /** The surface's existing session-switch path — the one the session picker calls. */
  readonly switchSession: (sessionId: string) => void;
  /** How a refusal reaches the operator (a system entry in the transcript). */
  readonly notify: (message: string) => void;
  /** Optional host-owned command for reopening a completed fork outside the attach view. */
  readonly formatResumeCommand?: (sessionId: string) => string;
}

/**
 * Attach to `entry`'s fork, or tell the operator why not: follow it while the job runs, switch onto
 * its record once it has ended.
 *
 * Returns what was done, so a caller — and a test — can see it. `undefined` means refused, and the
 * refusal has already been delivered through `notify`.
 */
export function attachToForkedSession(
  entry: IExecutionWorkspaceEntry,
  deps: IForkAttachDeps,
): TForkAttachOutcome | undefined {
  const outcome = resolveExecutionAttach(entry, deps.facts);
  if (outcome.type === 'refused') {
    const resumeCommand =
      outcome.resumeSessionId && deps.formatResumeCommand?.(outcome.resumeSessionId);
    deps.notify(
      resumeCommand ? `${outcome.reason} Open it with: ${resumeCommand}` : outcome.reason,
    );
    return undefined;
  }
  if (outcome.type === 'follow') {
    deps.followTask(entry);
    return { type: 'follow', taskId: outcome.taskId };
  }
  deps.switchSession(outcome.sessionId);
  return { type: 'switch', sessionId: outcome.sessionId };
}
