/**
 * Which admission step a channel still owes before the session may be exposed.
 *
 * Extracted from `pairing-gate.ts` because it is the one decision in that file that is a pure
 * function of configuration and state — and because it is the ORDERING that carries the security
 * argument, so it deserves to be readable and testable without a channel, a handshake or a session.
 *
 * The order is not arbitrary. Each step must run on a channel the previous one has already bound:
 *
 *   handshake     binds the CHANNEL — it terminates at the peer that knew the secret
 *   local-proof   binds the ENVIRONMENT — that peer reached a 0700 directory owned by this user
 *   handoff-grant binds the TRANSFER — one user, one destination, one channel, signed
 *
 * Each is opt-in, and configuring two means requiring both. That is strictly more restrictive than
 * requiring either, which is the safe direction — and it is the correct reading for a hand-off
 * between two sessions on ONE machine, which legitimately has both to present.
 */

/** The step still owed, or null when the session may be exposed. */
export type TAdmissionStep = 'local-proof' | 'handoff-grant' | null;

/** What the gate has configured. Named structurally so this module needs none of the gate's types. */
export interface IConfiguredAdmissionSteps {
  readonly localPeer?: unknown;
  readonly handoffGrant?: unknown;
}

/**
 * The next step, given what is configured and what has already run.
 *
 * `completed` is the gate's current state rather than a set of finished steps, because the states
 * ARE the record: reaching `handoff-grant` is only possible by having satisfied `local-proof` when
 * one was required.
 */
export function nextAdmissionStep(
  configured: IConfiguredAdmissionSteps,
  completed: string,
): TAdmissionStep {
  if (
    configured.localPeer !== undefined &&
    completed !== 'local-proof' &&
    completed !== 'handoff-grant'
  ) {
    return 'local-proof';
  }
  if (configured.handoffGrant !== undefined && completed !== 'handoff-grant')
    return 'handoff-grant';
  return null;
}
