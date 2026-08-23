/**
 * PEER-001 (#1809): the receiver's record of what it has already taken responsibility for.
 *
 * ## What this decides, and why it is not the carrier's job
 *
 * The issue requires delivery, acknowledgement, duplicate, retry and shutdown to produce
 * "deterministic, documented outcomes". Every one of those is a question about what the receiver has
 * SEEN BEFORE, which no carrier can answer: a WebRTC data channel redelivers on reconnect, a retry
 * repeats a message the sender already sent, and neither the socket nor the frame codec has any
 * memory to consult. So the decision lives here, once, and the carriers stay dumb.
 *
 * ## The rules, stated rather than emergent
 *
 * - **A repeated `id` is a duplicate**, and the ledger returns the SAME ack it returned the first
 *   time. That is what makes a retry safe: the sender learns the message landed, and the receiver
 *   does not deliver it twice. An ack that merely said "duplicate" without the original state would
 *   force the sender to guess whether the first attempt was accepted or refused.
 * - **Sequence is per origin.** Two peers are independent senders; a shared counter would make one
 *   peer's traffic look like the other's gap.
 * - **A gap is REPORTED, never silently reordered.** If sequence 5 arrives while 4 has not, the
 *   ledger says so. Buffering-and-reordering is a policy the session layer may choose; inventing it
 *   here would hide a lost message behind an apparent success, which is the failure mode this whole
 *   contract exists to avoid.
 * - **Nothing is remembered across shutdown.** The ledger is per-connection state by construction —
 *   a peer that reconnects gets a fresh sequence space, and the session layer decides what to do
 *   with a peer that restarts mid-conversation.
 */

import type {
  IPeerMessage,
  IPeerMessageAck,
  TPeerDeliveryState,
} from '@robota-sdk/agent-interface-session-mobility';

/**
 * What the receiver has seen from one origin.
 *
 * `delivered` is a SET, not just a high-water mark, and that distinction is the whole of review
 * finding #1. A high-water mark cannot tell "sequence 2 was already used" from "sequence 2 is the
 * gap we reported and it has just arrived" — and answering the second as if it were the first
 * refuses a message that was never delivered, permanently. `highestSequence` is kept alongside it
 * because reporting a gap needs the frontier, not the membership.
 *
 * Exported because it is reachable from `IPeerMessageLedger`. A public interface whose field type is
 * unexported is a name a consumer cannot write down (review finding #2). Measured: `tsdown` inlines
 * it into the bundled declaration so no TS4033 is raised today — the finding's build-breakage claim
 * does not reproduce — but a type nobody can name is still a bad public surface.
 */
export interface IOriginRecord {
  /** The highest sequence delivered from this origin — the frontier a gap is measured against. */
  highestSequence: number;
  /** Every sequence actually delivered. Membership, not a range: gaps get filled out of order. */
  delivered: Set<number>;
  /** Acks already issued, by message id, so a retry gets the original answer back. */
  issued: Map<string, IPeerMessageAck>;
}

/** Per-connection receive state. Created empty; discarded when the connection ends. */
export interface IPeerMessageLedger {
  readonly origins: Map<string, IOriginRecord>;
}

export function createPeerMessageLedger(): IPeerMessageLedger {
  return { origins: new Map() };
}

/** Why a message was not accepted, when it was not. */
export interface IPeerMessageRejection {
  readonly state: Extract<TPeerDeliveryState, 'refused' | 'failed'>;
  readonly reason: string;
}

export interface IPeerMessageVerdict {
  readonly ack: IPeerMessageAck;
  /**
   * Should the session deliver this to the agent?
   *
   * False for a duplicate and for a refusal. Separate from `ack.state` because a caller that
   * re-derived it from the state string would have to re-list which states mean "deliver", and that
   * list is exactly what drifts.
   */
  readonly deliver: boolean;
  /**
   * Set when this message's sequence is ahead of the last one delivered from its origin.
   *
   * Reported, not resolved. The session layer decides whether a gap is worth waiting for; the
   * ledger's job is to make sure it is never invisible.
   */
  readonly gapBefore?: number;
}

/**
 * Record a message and say what should happen to it.
 *
 * Pure with respect to its inputs except for the ledger it is handed, which it updates in place —
 * the caller owns the ledger's lifetime, so a connection ending is a reference going away rather
 * than a cleanup step someone can forget.
 */
export function admitPeerMessage(
  ledger: IPeerMessageLedger,
  message: IPeerMessage,
  rejection?: IPeerMessageRejection,
): IPeerMessageVerdict {
  const originId = message.origin.sessionId;
  let record = ledger.origins.get(originId);
  if (record === undefined) {
    record = { highestSequence: 0, delivered: new Set(), issued: new Map() };
    ledger.origins.set(originId, record);
  }

  // A repeated id is answered with the ORIGINAL verdict, before anything else is considered: a
  // retry must not be re-judged, or a message accepted once could be refused on its second arrival
  // and the sender would have two contradictory answers for one message.
  const previous = record.issued.get(message.id);
  if (previous !== undefined) {
    return { ack: { ...previous, state: 'duplicate' }, deliver: false };
  }

  if (rejection !== undefined) {
    const ack: IPeerMessageAck = {
      id: message.id,
      sequence: message.sequence,
      state: rejection.state,
      reason: rejection.reason,
    };
    record.issued.set(message.id, ack);
    return { ack, deliver: false };
  }

  // A sequence this origin ACTUALLY delivered before, under a different id: a sender reusing a
  // sequence, which is a protocol error rather than a duplicate.
  //
  // Membership, not `<= highestSequence`. The high-water form refused the late arrival of a gap it
  // had itself reported — deliver 1, receive 3 (gap at 2 reported), then 2 arrives and is rejected
  // as "already used" although it was never delivered. That contradicted this module's own stated
  // rule that a gap is reported so the SESSION layer can decide, since the session never got the
  // chance. Found in review.
  if (record.delivered.has(message.sequence)) {
    const ack: IPeerMessageAck = {
      id: message.id,
      sequence: message.sequence,
      state: 'refused',
      reason:
        `sequence ${message.sequence} was already delivered by this origin under a different ` +
        'message id. A retry must repeat its id; a new id on a delivered sequence cannot be ' +
        'ordered against what the receiver already has.',
    };
    record.issued.set(message.id, ack);
    return { ack, deliver: false };
  }

  const expected = record.highestSequence + 1;
  const gapBefore = message.sequence > expected ? expected : undefined;

  const ack: IPeerMessageAck = {
    id: message.id,
    sequence: message.sequence,
    state: 'delivered',
  };
  record.issued.set(message.id, ack);
  record.delivered.add(message.sequence);
  // The frontier only moves FORWARD. A gap arriving late fills membership without rewinding what a
  // later gap is measured against.
  record.highestSequence = Math.max(record.highestSequence, message.sequence);

  return gapBefore === undefined ? { ack, deliver: true } : { ack, deliver: true, gapBefore };
}

/**
 * Mark a delivered message as acknowledged by the agent side.
 *
 * Separate from `admitPeerMessage` because delivery and acknowledgement answer different questions —
 * "did the receiver take it" versus "did the agent act on it" — and a sender waiting for the second
 * must not be told the first.
 */
export function acknowledgePeerMessage(
  ledger: IPeerMessageLedger,
  originSessionId: string,
  id: string,
): IPeerMessageAck | undefined {
  const record = ledger.origins.get(originSessionId);
  const issued = record?.issued.get(id);
  if (record === undefined || issued === undefined || issued.state !== 'delivered')
    return undefined;
  const acknowledged: IPeerMessageAck = { ...issued, state: 'acknowledged' };
  record.issued.set(id, acknowledged);
  return acknowledged;
}

/** Forget one origin — used when a peer disconnects and its sequence space is no longer meaningful. */
export function forgetPeerOrigin(ledger: IPeerMessageLedger, originSessionId: string): void {
  ledger.origins.delete(originSessionId);
}
