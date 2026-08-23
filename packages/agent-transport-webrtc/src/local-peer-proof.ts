/**
 * SEC-010 TC-08: joining the rendezvous proof to the channel the session will run on.
 *
 * ## What each half proves, and why neither is enough alone
 *
 * The pairing handshake binds the CHANNEL: after it, this data channel provably terminates at the
 * peer that knew the secret, and the DTLS fingerprints are covered so it cannot be spliced. It says
 * nothing about where that peer runs.
 *
 * The guarded rendezvous binds the ENVIRONMENT: a peer that reached a 0700 directory owned by this
 * user could only have come from this machine, as this user. It says nothing about which channel
 * that peer later opens.
 *
 * Presenting the rendezvous nonce OVER the already-bound channel is what joins them. The channel is
 * authenticated by the time this runs, so nobody else can inject the frame; the nonce is single-use,
 * so nobody can re-present one they observed. Together they say: the party on this channel is the
 * party the kernel vouched for, on this attempt.
 *
 * ## Why this runs after the handshake and before the session
 *
 * Both edges are load-bearing.
 *
 * BEFORE the handshake completes, the channel is not yet authenticated — a nonce presented there
 * would be a secret handed to an unproven counterpart, and this step would weaken the very thing it
 * exists to strengthen.
 *
 * BEFORE the session is exposed, because "fail closed before content" is SEC-010's first failure
 * rule. If the proof arrived after exposure, a peer that never presents one would have already been
 * talking to the session, and refusing it afterwards is not refusing it.
 *
 * ## This package decides nothing
 *
 * #1810 is explicit that WebRTC must not implement cryptographic policy. Single-use, expiry and
 * revocation belong to the grant ledger in `@robota-sdk/agent-remote-pairing/local`, which is
 * node-only; this module takes an injected `redeem` and reports what it was told. That also keeps
 * `node:fs` out of this package, and keeps the ledger testable without a data channel.
 */

import type { IPeerAdmission } from '@robota-sdk/agent-interface-session-mobility';

/** The frame a local peer presents to show it reached the guarded rendezvous. */
export interface ILocalProofFrame {
  readonly t: 'local-proof';
  readonly nonce: string;
}

/**
 * The local-environment proof this gate requires before exposing the session.
 *
 * Absent → the gate behaves exactly as before. Requiring the proof is opt-in because a remote peer
 * over WebRTC has no rendezvous to have reached, and a gate that demanded one unconditionally would
 * refuse every legitimate remote session.
 */
export interface ILocalPeerProof {
  /**
   * Redeem a presented nonce. Owned by the ledger — this package asks and does not decide.
   *
   * Returns the admission the consumer receives, so the trust level travels as a value rather than
   * being re-derived from a boolean by whoever reads it next.
   */
  readonly redeem: (nonce: string) => IPeerAdmission;
  /**
   * Fired on the outcome, admitted or not.
   *
   * On BOTH, deliberately: a consumer told only about successes cannot distinguish "no local peer
   * connected" from "a local peer was refused", and those call for different operator responses.
   */
  readonly onAdmission?: (admission: IPeerAdmission) => void;
}

/**
 * True when a parsed pre-accept value is a local-proof frame carrying a nonce.
 *
 * Module-private: `judgeLocalProof` is the only thing that should ask. Exporting it would offer a
 * caller a way to check the shape and then act on it without going through the judge, which is how
 * an admission decision ends up made in two places.
 */
function isLocalProofFrame(value: unknown): value is ILocalProofFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { t?: unknown }).t === 'local-proof' &&
    typeof (value as { nonce?: unknown }).nonce === 'string'
  );
}

/** A refusal shaped like every other admission, so no caller has to special-case the failure path. */
function refuse(reason: string): IPeerAdmission {
  return { admitted: false, trust: 'unproven', reason };
}

/**
 * Judge one pre-accept frame against the configured proof.
 *
 * Every path that is not an admitted redemption returns a refusal — including a missing config,
 * which cannot happen through the gate but would be a fail-OPEN if it ever did.
 */
export function judgeLocalProof(
  parsed: unknown,
  proof: ILocalPeerProof | undefined,
): IPeerAdmission {
  if (proof === undefined) return refuse('no local-peer proof is configured for this channel');
  if (!isLocalProofFrame(parsed)) {
    return refuse('expected a local-proof frame carrying the rendezvous nonce');
  }
  try {
    return proof.redeem(parsed.nonce);
  } catch (error) {
    // allow-fallback: fail-CLOSED, not a fallback to a degraded path. A ledger that throws has not
    // reached a decision, and "not reached" is not "allowed" — the refusal below is strictly more
    // restrictive than the success path, never less. Letting it propagate would be worse: the throw
    // unwinds through the channel's message subscription and leaves the gate parked in its proof
    // state with the channel open, which is a hang — fail-open wearing a crash's clothes.
    return refuse(
      `the rendezvous ledger could not decide: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

/**
 * Build the frame a local peer presents on the channel.
 *
 * Lives beside the judge that reads it, so the two cannot drift: a sender that hand-built the object
 * would keep compiling after the frame gains a field, and the failure would surface as a refusal on
 * the far side with no hint that the SENDER is the stale half.
 *
 * Deliberately not a "send" — it returns the frame and leaves transmission to whoever owns the
 * channel. A helper that both built and sent would need a channel to be testable, and would put the
 * frame's shape and the carrier's lifecycle in one place.
 */
export function localProofFrame(nonce: string): ILocalProofFrame {
  return { t: 'local-proof', nonce };
}
