/**
 * HANDOFF-001 (#1811): moving a live session to another computer, without ever making ownership
 * ambiguous.
 *
 * ## Not a resume buffer
 *
 * The issue names the reuse to avoid: `SessionResumeBridge` is a connection-reconnect buffer that
 * replays sequenced messages a client missed. A hand-off moves **authority** — afterwards one
 * machine is in charge and the other is not. Similar surfaces, different meanings, and widening the
 * first into the second is how a session ends up half-owned.
 *
 * ## There is no atomic commit across two machines, so the window is made HARMLESS
 *
 * The acceptance criteria ask for two things that cannot both hold at one instant: the source stays
 * authoritative until the destination has persisted, and the source is not marked handed off until
 * the destination's acknowledgement is durable. Between those, the network can drop. That window is
 * the two-generals problem and cannot be closed.
 *
 * The rule that makes it harmless: **the source only ever gives up authority on evidence it holds.**
 * Every failure resolves the same way — source stays authoritative — and a duplicate arrival is
 * idempotent by `handoffId`, so a retried commit is not a second hand-off. Each phase below is safe
 * to die in.
 *
 * ## What is NOT in the manifest, and why that is the interesting half
 *
 * Provider credentials are never transferred. SEC-009 established that a resolved secret must not
 * cross a PROCESS boundary; a machine boundary is strictly worse. The destination resolves its own
 * credential from its own environment, and a hand-off to a machine without one fails loudly at
 * commit rather than silently later.
 *
 * Running subprocesses and uncommitted working-tree changes stay on the source: a process cannot
 * migrate, and moving files would make this a file-sync product. Their existence is REPORTED so the
 * user decides, rather than being silently dropped.
 */

import type { IInteractiveSessionRecord } from './session-contracts.js';

/**
 * Where a transfer is, from the source's point of view.
 *
 * Ordered so that every crash point is safe:
 *
 * | Phase | Source | Destination | If it dies here |
 * | --- | --- | --- | --- |
 * | `offered` | authoritative | nothing | nothing happened |
 * | `transferring` | authoritative | staging | destination discards |
 * | `staged` | authoritative | verified, NOT live | destination discards on timeout |
 * | `committed` | read-only | live | the transfer succeeded |
 * | `abandoned` | authoritative | discarded | explicit, at either end |
 */
export type THandoffPhase = 'offered' | 'transferring' | 'staged' | 'committed' | 'abandoned';

/** How a piece of session state relates to the transfer. Every category is deliberate. */
export type THandoffDisposition =
  /** Carried in the manifest and restored on the destination. */
  | 'transferred'
  /** Carried as a REFERENCE the destination must resolve locally (a path, a snapshot id). */
  | 'rehydrated'
  /** Stays on the source. Reported to the user rather than silently dropped. */
  | 'source-local'
  /**
   * MUST NOT cross the boundary, by rule rather than by circumstance.
   *
   * Split from `source-local` because the two are not the same statement. Uncommitted working-tree
   * changes stay behind as a product decision that could be revisited; a resolved provider
   * credential stays behind because SEC-009 established that it must not cross a process boundary,
   * and a machine boundary is strictly worse. Collapsing them would leave nothing in the type to
   * stop a later change from helpfully starting to carry the credential along — and the destination
   * resolving its OWN credential is what makes a hand-off to a machine without one fail loudly at
   * commit instead of silently later.
   */
  | 'never-transferred';

/**
 * One classified piece of state.
 *
 * The issue requires the working directory, uncommitted changes, provider credentials, running
 * subprocesses and in-flight calls to each be classified EXPLICITLY. Making the classification a
 * value rather than a comment is what lets the destination and the UI both read it.
 */
export interface IHandoffStateItem {
  readonly kind: string;
  readonly disposition: THandoffDisposition;
  /** Shown to the user at both ends when the disposition is not `transferred`. */
  readonly note?: string;
}

/** Integrity metadata for the transferred payload. */
export interface IHandoffIntegrity {
  /** base64url SHA-256 of the serialized record. */
  readonly digest: string;
  /** Byte length of the serialized record, so a truncated transfer is detectable before hashing. */
  readonly byteLength: number;
}

/**
 * The offer: what is being moved, to whom, and what will NOT come along.
 *
 * `sessionId` and `handoffId` are separate — one session may be offered more than once over its
 * life, and a retry of one offer must be recognisable as the same transfer.
 */
export interface IHandoffManifest {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  /** Every classified piece of state, including the ones staying behind. */
  readonly inventory: readonly IHandoffStateItem[];
  readonly integrity: IHandoffIntegrity;
  readonly offeredAt: number;
}

/** The payload itself, sent after the manifest is accepted. */
export interface IHandoffPayload {
  readonly handoffId: string;
  readonly record: IInteractiveSessionRecord;
}

/**
 * The destination's durable acknowledgement — the ONLY thing that moves the source to read-only.
 *
 * `persisted` is the load-bearing field: it asserts the destination has the transfer on disk, not
 * that it received the bytes. A source that transitioned on receipt would hand off to a destination
 * that then crashed before writing.
 */
export interface IHandoffCommitAck {
  readonly handoffId: string;
  readonly destinationDeviceId: string;
  readonly persisted: true;
  readonly committedAt: number;
}

/** Why a hand-off ended without committing. */
export type THandoffRefusal =
  | 'integrity-failed'
  /**
   * The bytes arrived whole and did not decode as a session record (TRANS-006).
   *
   * Distinct from `integrity-failed` because integrity PASSED — the digest matched and the byte
   * count matched, and only the shape was wrong. The two require opposite actions from the source:
   * an integrity failure is retried, and this one never is, because a retransmission produces the
   * identical payload and the identical refusal. Reporting one as the other sends a source into a
   * loop it cannot leave.
   *
   * Distinct from `destination-cannot-resume` because that asserts something about THIS machine,
   * while a payload that does not decode is malformed at every destination.
   */
  | 'payload-undecodable'
  | 'unauthorized'
  | 'destination-cannot-resume'
  | 'in-flight-work'
  | 'cancelled'
  | 'timed-out';

export interface IHandoffOutcome {
  readonly handoffId: string;
  readonly phase: THandoffPhase;
  /** Present when the phase is not `committed`. */
  readonly refusal?: THandoffRefusal;
  readonly detail?: string;
}

/**
 * Is the source still in charge?
 *
 * A type predicate over this package's own vocabulary — what a contract package may publish. Asked
 * as a question rather than compared inline, because the answer must be identical everywhere: a
 * surface that decided authority for itself is how two machines both believe they own a session.
 */
export function sourceRetainsAuthority(
  phase: THandoffPhase,
): phase is Exclude<THandoffPhase, 'committed'> {
  return phase !== 'committed';
}

/**
 * Is this outcome a completed transfer?
 *
 * Deliberately NOT `!refusal`: a phase of `staged` with no refusal is an in-progress transfer, and
 * reading it as success would hand authority away before the destination committed.
 */
export function isHandoffCommitted(outcome: IHandoffOutcome): outcome is IHandoffOutcome & {
  readonly phase: 'committed';
} {
  return outcome.phase === 'committed' && outcome.refusal === undefined;
}
