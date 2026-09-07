/**
 * CLI-1994: the TUI half of `attach` — turning the workspace entry the operator picked into either
 * a session switch or a stated refusal.
 *
 * The DECISION is not made here. `resolveExecutionAttach` is the framework's, beside the projection
 * that decides when the control is offered, so the surface cannot invent a second answer to "may
 * this be attached to". What this module owns is the surface's part: the refusal reaches the
 * operator as a message, and the switch goes through the SAME session-switch path the session
 * picker uses — a new channel from the factory, the previous one stopped first.
 *
 * A switch is a VIEW change. Nothing is merged: the parent session's record is not read or written,
 * and the two records stay separate exactly as `/fork` left them.
 */

import { resolveExecutionAttach } from '@robota-sdk/agent-framework';

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-command';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/** The `switch-session` member of the command layer's UI-intent union, narrowed to itself. */
export type TSwitchSessionIntent = Extract<TCommandUiIntent, { type: 'switch-session' }>;

export interface IForkAttachDeps {
  /** Whether the forked record is still in the store this surface would switch onto. */
  readonly hasSessionRecord: (sessionId: string) => boolean;
  /** The surface's existing session-switch path — the one the session picker calls. */
  readonly switchSession: (sessionId: string) => void;
  /** How a refusal reaches the operator (a system entry in the transcript). */
  readonly notify: (message: string) => void;
}

/**
 * Attach to `entry`'s forked session, or tell the operator why not.
 *
 * Returns the UI intent that was emitted, so a caller — and a test — can see the switch as the
 * command layer's own vocabulary rather than as a side effect. `undefined` means refused, and the
 * refusal has already been delivered through `notify`.
 */
export function attachToForkedSession(
  entry: IExecutionWorkspaceEntry,
  deps: IForkAttachDeps,
): TSwitchSessionIntent | undefined {
  const outcome = resolveExecutionAttach(entry, { hasSessionRecord: deps.hasSessionRecord });
  if (outcome.type === 'refused') {
    deps.notify(outcome.reason);
    return undefined;
  }
  const intent: TSwitchSessionIntent = { type: 'switch-session', sessionId: outcome.sessionId };
  deps.switchSession(intent.sessionId);
  return intent;
}
