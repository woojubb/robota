/**
 * PEER-001 (#1809): the transport-neutral contract for a message between two live agent sessions.
 *
 * ## Why this is a new contract rather than a reuse
 *
 * `TClientMessage.submit` already carries text into a session, and reaching for it would be the
 * cheap move. It is the wrong one, and the issue says so explicitly: `submit` is a REMOTE SURFACE
 * DRIVING A HOST SESSION — one party is the operator, the other is the agent being operated. A peer
 * message is symmetric: two sessions, each with its own agent, neither driving the other. Silently
 * widening `submit` would make those two situations indistinguishable at the point where a session
 * decides how much authority the sender has.
 *
 * ## The two axes that must not collapse into one
 *
 * A peer is admitted on TWO independent questions, and #1810 exists because they had been conflated:
 *
 *   - **What did it present?** — `ITransportAdmission` (SEC-008): a token, or an explicit decision to
 *     run open. This is POSSESSION, and possession is copyable.
 *   - **Where did it come from?** — the environment proof (SEC-010): evidence the operating system
 *     enforces, which no artifact can carry to another machine.
 *
 * A boolean "authenticated" would erase the difference. `IPeerAdmission` therefore carries both, and
 * `trust` names what was actually established rather than how the caller feels about it.
 *
 * ## What lives here and what does not
 *
 * Types only. This package is inert by rule — no classes, no runtime dependency edges — so the wire
 * frames, sequencing and retry machinery live in `@robota-sdk/agent-transport-protocol`, and the
 * session ingress in `@robota-sdk/agent-framework`. What is declared here is the shape those agree
 * on.
 */

import type { TDriverId } from './driver-contracts.js';

/**
 * How much was established about a peer, as a closed vocabulary.
 *
 * `same-user-same-host` is the strongest a LOCAL peer can reach and is what SEC-010's kernel-enforced
 * rendezvous produces. `token-only` means a credential was presented and nothing about origin was
 * proven — correct for a remote peer, and NOT interchangeable with the first however convenient a
 * single boolean would be.
 *
 * `same-user-different-host` (SEC-011, issue #1865) is what a verified cross-device hand-off grant
 * produces: the same user, provably, on a machine that is provably NOT this one. It sits BETWEEN the
 * other two and is interchangeable with neither. Against `same-user-same-host` the difference is
 * load-bearing — a check that wanted same-machine (a guarded 0700 directory the kernel vouched for)
 * must never be satisfied by a signature that says nothing about where the peer runs. Against
 * `token-only` the difference is that a user root key signed the device certificate, so the origin
 * IS proven; collapsing it downward would throw away the thing the grant exists to establish.
 */
export type TPeerTrust =
  'same-user-same-host' | 'same-user-different-host' | 'token-only' | 'unproven';

/**
 * Who a message came from.
 *
 * `driverId` is display and attribution ONLY. The issue is explicit that it must never become an
 * authentication or authorization input, and it is carried here beside `trust` precisely so the
 * distinction is visible at every read: one says who to render, the other says what was proven.
 */
export interface IPeerOrigin {
  /** The peer session's own id. Stable for the life of that session. */
  readonly sessionId: string;
  /** Display attribution only — never an admission input. */
  readonly driverId?: TDriverId;
}

/** The result a messaging feature receives from an admission port. Never a bare boolean. */
export interface IPeerAdmission {
  readonly admitted: boolean;
  /** What was actually established. `unproven` accompanies every refusal. */
  readonly trust: TPeerTrust;
  /** Present only when admitted; absent is not "unknown but probably fine". */
  readonly origin?: IPeerOrigin;
  /** Why admission was refused, for the operator. Absent when admitted. */
  readonly reason?: string;
}

/**
 * Delivery state, as the sender observes it.
 *
 * `duplicate` is a distinct terminal state rather than a second `delivered`: the issue requires
 * duplicates to produce a deterministic, documented outcome, and a sender that cannot tell a
 * re-delivery from a first delivery cannot honour that.
 */
export type TPeerDeliveryState =
  'pending' | 'delivered' | 'acknowledged' | 'duplicate' | 'refused' | 'failed';

/**
 * One message between peers.
 *
 * `id` is stable across retries — it is what makes a duplicate recognisable as one — while
 * `sequence` orders messages from a single origin. Two fields because they answer different
 * questions: a retry repeats the id and keeps its sequence, so collapsing them would make every
 * retry look like a new message and defeat the duplicate rule above.
 */
export interface IPeerMessage {
  readonly id: string;
  readonly sequence: number;
  readonly origin: IPeerOrigin;
  readonly text: string;
  /** Milliseconds since the epoch, stamped by the sender. Ordering uses `sequence`, not this. */
  readonly sentAt: number;
}

/** What the receiver returns for a message it has taken responsibility for. */
export interface IPeerMessageAck {
  readonly id: string;
  readonly sequence: number;
  readonly state: TPeerDeliveryState;
  /** Set when `state` is `refused` or `failed`. */
  readonly reason?: string;
}

/**
 * A peer message as the RECEIVING runtime sees it: the message plus what was proven about its
 * sender.
 *
 * The two travel together deliberately. A session deciding how to treat incoming text needs the
 * trust level at the same moment it has the text, and a shape that delivered them separately would
 * invite the decision to be made before the evidence arrives.
 */
export interface IPeerMessageIngress {
  readonly message: IPeerMessage;
  readonly admission: IPeerAdmission;
}

/**
 * The narrow port a session exposes for peer messaging.
 *
 * Deliberately does NOT include discovery, pairing, or transport lifecycle: those belong to the
 * shell (`agent-cli`) and the carrier. What a session owns is sending, and being told when
 * something arrived.
 */
export interface ISessionPeerMessagingPort {
  send(text: string): Promise<IPeerMessageAck>;
  onPeerMessage(listener: (ingress: IPeerMessageIngress) => void): () => void;
}

/**
 * Is this delivery state terminal — is there nothing further to wait for?
 *
 * A type PREDICATE, not a boolean helper, and the difference is enforced: `scan-interface-runtime`
 * lets a contract package publish its vocabulary and its discriminators and nothing else, and a
 * function returning bare `boolean` is a mechanism by that rule. Narrowing is also what a caller
 * actually wants — after this returns true the state is provably not `pending`.
 */
export function isTerminalPeerDelivery(
  state: TPeerDeliveryState,
): state is Exclude<TPeerDeliveryState, 'pending'> {
  return state !== 'pending';
}

/**
 * Did admission establish that the peer shares this machine and user account?
 *
 * Named for what it proves rather than `isTrusted`, because "trusted" invites a caller to read it as
 * a general permission. It answers exactly one question, and narrows `origin` to present at the same
 * time — an admitted peer whose origin is missing is not a peer this can vouch for.
 */
export function isSameEnvironmentPeer(admission: IPeerAdmission): admission is IPeerAdmission & {
  readonly trust: 'same-user-same-host';
  readonly origin: IPeerOrigin;
} {
  return (
    admission.admitted &&
    admission.trust === 'same-user-same-host' &&
    admission.origin !== undefined
  );
}
