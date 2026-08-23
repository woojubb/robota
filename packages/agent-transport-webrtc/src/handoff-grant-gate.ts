/**
 * SEC-011 (issue #1865): the channel gate consumes the cross-device hand-off grant.
 *
 * The same shape SEC-010's local-proof step established, for the same reason. #1810 is explicit that
 * this package must not implement cryptographic policy, so nothing here verifies a signature,
 * decides an expiry, or knows what revocation is. The gate holds the state machine; the verdict is
 * injected and reported.
 *
 * ## What the grant proves, and what the channel proves
 *
 * The pairing handshake binds the CHANNEL: after it, this data channel provably terminates at the
 * peer that knew the secret, and the DTLS fingerprints are covered so it cannot be spliced. It says
 * nothing about who that peer is.
 *
 * The grant binds the TRANSFER: one user, one source device, one destination, one `handoffId`, one
 * `sessionId`, one nonce, and the fingerprint of the channel it may be presented over. It says
 * nothing about whether the channel it arrived on is the one it names.
 *
 * Presenting the grant OVER the already-bound channel is what joins them, and the fingerprint claim
 * is what makes the join checkable: a grant lifted from one channel and replayed on another names a
 * fingerprint the verifier does not observe. That is `channel-substituted`, and it is a distinct
 * rejection precisely so it cannot be softened into a pass.
 *
 * ## Why it runs after the handshake and before the session
 *
 * Both edges are load-bearing, and both for SEC-010's reasons.
 *
 * BEFORE the handshake completes, the channel is not authenticated — a grant presented there would
 * be handed to an unproven counterpart, and this step would weaken what it exists to strengthen.
 *
 * BEFORE the session is exposed, because "fail closed before content" is the first failure rule. A
 * peer that never presents a grant must not have been talking to the session already; refusing it
 * afterwards is not refusing it.
 *
 * ## The trust it produces is its own
 *
 * `same-user-different-host` is not `same-user-same-host`. #1812 pins that they are different values
 * and this gate is the reason: a cross-device authorization must never satisfy a check that wanted
 * same-machine. It travels as a value on the admission rather than being re-derived from a boolean
 * by whoever reads it next.
 */

import type { IPeerAdmission } from '@robota-sdk/agent-interface-session-mobility';

/** The frame a source device presents to show it holds a grant for this transfer. */
export interface IHandoffGrantFrame {
  readonly t: 'handoff-grant';
  /**
   * The signed grant, carried opaquely.
   *
   * `unknown` on purpose: this package cannot import the grant type without importing the package
   * that owns the crypto, and typing it structurally here would create a second declaration of a
   * signed object's shape — which is how a field ends up checked in one copy and not the other.
   * The verifier owns the type; this gate owns the envelope.
   */
  readonly grant: unknown;
}

/**
 * The cross-device authorization this gate requires before exposing the session.
 *
 * Absent → the gate behaves exactly as before. Requiring a grant is opt-in because an ordinary
 * remote peer has no hand-off to authorize, and a gate that demanded one unconditionally would
 * refuse every legitimate remote session.
 */
export interface IHandoffGrantProof {
  /**
   * Judge a presented grant. Owned by the verifier — this package asks and does not decide.
   *
   * Async because verifying a signature is: `verifyHandoffGrant` returns a promise, and a
   * synchronous seam here would force the owner to block or to pre-verify, and pre-verifying means
   * deciding before the channel that the grant is bound to even exists.
   *
   * Returns the admission the consumer receives, so the trust level travels as a value.
   */
  readonly verify: (grant: unknown) => Promise<IPeerAdmission>;
  /**
   * Ask the person at THIS machine whether to accept the transfer. Absent → no consent is required.
   *
   * Called ONLY on a verdict the verifier admitted, and given that verdict, for two reasons that
   * both matter:
   *
   * The prompt can then name a PROVEN origin. Asking before verification would let anyone who can
   * open a channel raise a dialog on someone's machine claiming to be any device they like, which
   * turns the consent step into an attack surface instead of a control.
   *
   * And consent is not cryptographic policy, so it does not belong inside `verify`. A verifier that
   * also asked a human would make "is this grant valid" and "does this person want it" one answer,
   * and the first is the one that must be decidable without a person present.
   *
   * Returning false — or throwing, or having no renderer to ask — refuses. Denial fails CLOSED.
   */
  readonly consent?: (admission: IPeerAdmission) => Promise<boolean>;
  /**
   * Fired on the outcome, admitted or not.
   *
   * On BOTH, deliberately: a consumer told only about successes cannot distinguish "no hand-off was
   * offered" from "a hand-off was refused", and those call for different operator responses — the
   * second is the one that belongs in front of a person.
   */
  readonly onAdmission?: (admission: IPeerAdmission) => void;
}

/**
 * True when a parsed pre-accept value is a grant frame.
 *
 * Module-private: `judgeHandoffGrant` is the only thing that should ask. Exporting it would offer a
 * caller a way to check the shape and then act on it without going through the judge, which is how
 * an admission decision ends up made in two places.
 */
function isHandoffGrantFrame(value: unknown): value is IHandoffGrantFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { t?: unknown }).t === 'handoff-grant' &&
    (value as { grant?: unknown }).grant !== undefined
  );
}

/** A refusal shaped like every other admission, so no caller has to special-case the failure path. */
function refuse(reason: string): IPeerAdmission {
  return { admitted: false, trust: 'unproven', reason };
}

/**
 * Judge one pre-accept frame against the configured grant proof.
 *
 * Every path that is not an admitted verification returns a refusal — including a missing config,
 * which cannot happen through the gate but would be a fail-OPEN if it ever did.
 */
export async function judgeHandoffGrant(
  parsed: unknown,
  proof: IHandoffGrantProof | undefined,
): Promise<IPeerAdmission> {
  if (proof === undefined)
    return refuse('no hand-off grant verifier is configured for this channel');
  if (!isHandoffGrantFrame(parsed)) {
    return refuse('expected a handoff-grant frame carrying the signed grant');
  }
  try {
    const admission = await proof.verify(parsed.grant);
    // The verifier owns the verdict, but not the ability to widen it. A cross-device grant cannot
    // establish that the peer is on THIS machine, so an admission claiming it did is refused rather
    // than passed on — an implementation that returned the stronger level would otherwise satisfy
    // every check that wanted same-machine, which is the one substitution #1812 forbids by name.
    if (admission.admitted && admission.trust === 'same-user-same-host') {
      return refuse(
        'the grant verifier returned same-user-same-host. A cross-device grant proves the user, ' +
          'not the machine — see SEC-010 for what same-host requires.',
      );
    }
    if (!admission.admitted || proof.consent === undefined) return admission;
    // The person, after the proof. A refusal here is not a weaker outcome than a cryptographic one:
    // the session is equally not exposed, and the reason says which step declined so the operator is
    // not left reading "unauthorized" when what happened is that they said no.
    if (!(await proof.consent(admission))) {
      return refuse('the person at this machine declined the transfer');
    }
    return admission;
  } catch (error) {
    // allow-fallback: fail-CLOSED, not a fallback to a degraded path. A verifier that throws has not
    // reached a decision, and "not reached" is not "allowed" — the refusal below is strictly more
    // restrictive than the success path, never less. Letting it propagate would be worse: the throw
    // unwinds through the channel's message subscription and leaves the gate parked in its grant
    // state with the channel open, which is a hang — fail-open wearing a crash's clothes.
    return refuse(
      `the grant verifier could not decide: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

/**
 * Build the frame a source device presents on the channel.
 *
 * Lives beside the judge that reads it, so the two cannot drift: a sender that hand-built the object
 * would keep compiling after the frame gains a field, and the failure would surface as a refusal on
 * the far side with no hint that the SENDER is the stale half.
 *
 * Deliberately not a "send" — it returns the frame and leaves transmission to whoever owns the
 * channel, for the same reason `localProofFrame` does.
 */
export function handoffGrantFrame(grant: unknown): IHandoffGrantFrame {
  return { t: 'handoff-grant', grant };
}
