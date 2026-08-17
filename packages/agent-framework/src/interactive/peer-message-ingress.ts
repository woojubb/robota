/**
 * PEER-002 (#1809): how a peer message becomes something the agent can read, without losing where it
 * came from.
 *
 * ## The requirement that shapes this
 *
 * The issue asks that an incoming message "be added to the receiving runtime context with explicit
 * peer origin and can trigger an agent response". Both halves matter, and the second is why the
 * origin cannot be flattened into the text: an agent that answers a peer must be able to tell that
 * it is answering a PEER rather than its own operator, because the two carry different authority.
 * So the message is submitted with `turnSource: 'peer'` and the peer's driver id — origin the
 * runtime can branch on, not prose it would have to parse.
 *
 * `TDriverId` is display attribution and must never become an authorization input — the contract
 * says so and asserts it. The trust level travels separately, in the admission this module checks.
 *
 * ## What this module does NOT do, and why that is the whole design
 *
 * A peer message arriving while a turn is running is an instance of "an input arrived mid-turn", and
 * this repository already answered that question: `submitNewTurn` checks the execution claim,
 * `PendingInputQueue` holds what cannot run yet under a bounded depth, and every entry that will
 * never run settles its caller's handle with a typed `TTurnNotRunReason` (RUNTIME-003).
 *
 * The first draft of this file re-implemented all four of those — its own busy check, its own queue,
 * its own bound, its own drain — which is a second answer to a settled question, and the review that
 * caught it found two defects in the copy that the original had never had. There is no queue here
 * now. This module owns only what is genuinely peer-specific:
 *
 *  1. **Fail closed on admission.** A message from a peer that was not admitted never reaches the
 *     runtime, and the stricter same-environment posture is available for a caller that wants it.
 *  2. **Preserve origin.** Submit as a peer turn, attributed to the peer.
 *  3. **Translate settlement into an ack.** The turn handle settles — with a result, or with a
 *     `TurnNotRunError` naming why it never ran — and that is what the sender is told.
 *
 * ## Concurrency semantics, which the issue requires documented rather than discovered
 *
 * - **Idle session** → the message runs as a turn and the ack settles `acknowledged`.
 * - **Busy session** → the existing pending queue holds it; the ack is `pending` until it settles.
 * - **Superseded** → the pending queue coalesces a same-driver tail (last-wins per driver), so a
 *   second message from one peer arriving mid-turn replaces the first. The replaced one is NOT lost
 *   silently: it settles `refused` with reason `coalesced`, so the sender learns. Whether peer input
 *   should be exempt from that policy is a question about the REMOTE-014 E5 queue rather than about
 *   this module, and it is filed rather than worked around here.
 * - **Queue full** → settles `refused` with reason `dropped`.
 * - **Shutdown/cancel** → settles `refused` with reason `cancelled`.
 */

import { isSameEnvironmentPeer } from '@robota-sdk/agent-interface-transport';

import type {
  IPeerMessageAck,
  IPeerMessageIngress,
  IPeerOrigin,
  ITurnHandle,
  ITurnNotRunError,
} from '@robota-sdk/agent-interface-transport';

/** What happened to an arriving peer message at the moment it was received. */
export type TIngressOutcome =
  /** Handed to the session. Whether it runs now or waits is the session's existing decision. */
  | 'accepted'
  /** Never reached the runtime — admission did not establish enough, or the session is closing. */
  | 'refused';

export interface IIngressResult {
  readonly outcome: TIngressOutcome;
  /** The immediate ack: `pending` for an accepted message, `refused` for one that was not. */
  readonly ack: IPeerMessageAck;
  /**
   * The FINAL ack, once the turn ran or was settled as never-run.
   *
   * Present only when accepted. Separate from `ack` because the sender needs an answer before the
   * turn finishes — a message queued behind a long turn would otherwise leave it silent for minutes
   * — and a promise is the honest way to say "this is not settled yet".
   */
  readonly settled?: Promise<IPeerMessageAck>;
}

/**
 * The narrow view of a session this module needs.
 *
 * Exactly one operation, because that is the whole dependency: submit a peer turn and hand back the
 * handle it settles on. Taking the session itself would let this module grow into a second place
 * that knows how sessions work — which is the mistake this file already made once.
 */
export interface IPeerIngressHost {
  submit(input: string, origin: IPeerOrigin): Promise<ITurnHandle>;
}

export interface IPeerIngressOptions {
  /**
   * Require the strongest local proof before a message reaches the runtime.
   *
   * Default false: #1809 owns message flow and #1810 owns admission, and this module must not
   * quietly become a second admission gate. A composition root that wants the stricter posture asks
   * for it explicitly.
   */
  readonly requireSameEnvironment?: boolean;
}

function isTurnNotRun(error: unknown): error is ITurnNotRunError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'TurnNotRunError'
  );
}

/** The receiving side of peer messaging for one session. */
export class PeerMessageIngress {
  constructor(
    private readonly host: IPeerIngressHost,
    private readonly options: IPeerIngressOptions = {},
  ) {}

  /** Take a peer message and either submit it to the session or refuse it. */
  async receive(ingress: IPeerMessageIngress): Promise<IIngressResult> {
    const base = { id: ingress.message.id, sequence: ingress.message.sequence };
    const refuse = (reason: string): IIngressResult => ({
      outcome: 'refused',
      ack: { ...base, state: 'refused', reason },
    });

    if (!ingress.admission.admitted) {
      return refuse(ingress.admission.reason ?? 'the peer was not admitted');
    }

    if (this.options.requireSameEnvironment === true && !isSameEnvironmentPeer(ingress.admission)) {
      return refuse(
        `this session requires a same-environment peer; admission established ` +
          `'${ingress.admission.trust}'. A token proves possession, which is copyable, and says ` +
          'nothing about where the peer runs.',
      );
    }

    let handle: ITurnHandle;
    try {
      handle = await this.host.submit(ingress.message.text, ingress.message.origin);
    } catch (error) {
      // A session that is shutting down rejects the submission outright. That is a refusal the
      // sender must hear rather than a crash in whatever is pumping the channel.
      return refuse(error instanceof Error ? error.message : 'the session refused the submission');
    }

    return {
      outcome: 'accepted',
      // `delivered` would claim the runtime has it in hand; it may be waiting behind a turn.
      // `pending` is the contract's word for "not settled", which is what is true right now.
      ack: { ...base, state: 'pending' },
      settled: handle.completed.then(
        (): IPeerMessageAck => ({ ...base, state: 'acknowledged' }),
        (error: unknown): IPeerMessageAck => ({
          ...base,
          state: 'refused',
          // The typed reason is the point of RUNTIME-003: 'coalesced' (a newer message from this
          // peer superseded it) and 'dropped' (the queue was full) are different facts, and a
          // sender forced to regex a message string to tell them apart has learned nothing.
          reason: isTurnNotRun(error) ? error.reason : 'the turn failed',
        }),
      ),
    };
  }
}
