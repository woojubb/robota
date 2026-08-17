/**
 * HANDOFF-001 (#1811): the ownership transaction, as a state machine whose every failure lands in
 * the same place.
 *
 * ## The invariant
 *
 * **The source gives up authority only on evidence it holds** — a durable acknowledgement from the
 * destination saying the transfer is on disk there. Nothing else moves it. That single rule is what
 * makes the unavoidable network window harmless: between the destination persisting and the source
 * learning of it, the connection can drop, and the answer is always the same — the source is still
 * in charge, and a re-delivered acknowledgement finishes the job.
 *
 * A duplicate is idempotent by `handoffId`, so a retried commit is not a second hand-off. That
 * matters more here than in most protocols: a second hand-off of an already-transferred session
 * would be a transfer of something the source no longer owns.
 *
 * ## Why the transitions are exhaustive rather than permissive
 *
 * Every illegal transition is REFUSED with the phase unchanged, rather than ignored. An ignored
 * transition leaves the caller believing it happened, which in an ownership protocol means two
 * machines can each believe they are authoritative — the exact ambiguity the acceptance criteria
 * forbid.
 */

import {
  sourceRetainsAuthority,
  type IHandoffCommitAck,
  type IHandoffManifest,
  type IHandoffOutcome,
  type THandoffPhase,
  type THandoffRefusal,
} from '@robota-sdk/agent-interface-transport';

/** One transfer's state, as the SOURCE sees it. */
export interface IHandoffTransaction {
  readonly handoffId: string;
  readonly sessionId: string;
  phase: THandoffPhase;
  refusal?: THandoffRefusal;
  detail?: string;
  /** The acknowledgement that moved this to `committed`, kept so a duplicate is answerable. */
  ack?: IHandoffCommitAck;
}

export function beginHandoff(manifest: IHandoffManifest): IHandoffTransaction {
  return { handoffId: manifest.handoffId, sessionId: manifest.sessionId, phase: 'offered' };
}

/** Which phases may follow which. Absent from this map means "not reachable from there". */
const ALLOWED: Readonly<Record<THandoffPhase, readonly THandoffPhase[]>> = {
  offered: ['transferring', 'abandoned'],
  transferring: ['staged', 'abandoned'],
  staged: ['committed', 'abandoned'],
  // Terminal. A committed transfer cannot be abandoned — the destination is already live, and
  // "un-committing" would leave the session owned by nobody.
  committed: [],
  abandoned: [],
};

export interface ITransitionResult {
  readonly accepted: boolean;
  readonly transaction: IHandoffTransaction;
  /** Why a transition was refused. Absent when accepted. */
  readonly reason?: string;
}

/**
 * Advance a transfer, or refuse and say why.
 *
 * Refusing rather than ignoring is deliberate — see the header. The transaction is returned either
 * way so a caller cannot accidentally read a stale copy after a refusal.
 */
export function advanceHandoff(
  transaction: IHandoffTransaction,
  next: THandoffPhase,
  detail?: { refusal?: THandoffRefusal; detail?: string },
): ITransitionResult {
  if (!ALLOWED[transaction.phase].includes(next)) {
    return {
      accepted: false,
      transaction,
      reason:
        `a hand-off in phase '${transaction.phase}' cannot move to '${next}'. Refused rather than ` +
        'ignored: an ignored transition leaves the caller believing it happened, and in an ' +
        'ownership protocol that means two machines can each believe they are authoritative.',
    };
  }
  transaction.phase = next;
  if (detail?.refusal !== undefined) transaction.refusal = detail.refusal;
  if (detail?.detail !== undefined) transaction.detail = detail.detail;
  return { accepted: true, transaction };
}

export interface ICommitResult extends ITransitionResult {
  /** True when this exact acknowledgement had already been applied — a retry, not a second commit. */
  readonly duplicate?: boolean;
}

/**
 * Apply the destination's durable acknowledgement. The ONLY path to `committed`.
 *
 * `persisted` is checked rather than trusted from the phase: an acknowledgement that merely says
 * "received" must not move authority, because a destination that crashes before writing would leave
 * the session owned by nobody.
 */
export function commitHandoff(
  transaction: IHandoffTransaction,
  ack: IHandoffCommitAck,
): ICommitResult {
  if (ack.handoffId !== transaction.handoffId) {
    return {
      accepted: false,
      transaction,
      reason:
        `acknowledgement is for hand-off '${ack.handoffId}', not '${transaction.handoffId}'. An ` +
        'ack from another transfer must never move this one.',
    };
  }

  // Idempotent by construction: a re-delivered ack for a transfer already committed is the
  // successful case of the network window this protocol is built around, not an error.
  if (transaction.phase === 'committed') {
    return { accepted: true, transaction, duplicate: true };
  }

  if (ack.persisted !== true) {
    return {
      accepted: false,
      transaction,
      reason:
        'the acknowledgement does not assert durable persistence. Receipt is not persistence — a ' +
        'destination that crashed before writing would leave the session owned by nobody.',
    };
  }

  const advanced = advanceHandoff(transaction, 'committed');
  if (!advanced.accepted) return advanced;
  transaction.ack = ack;
  return { accepted: true, transaction };
}

/**
 * The outcome a caller reports, derived from the transaction rather than assembled at each call site.
 */
export function handoffOutcome(transaction: IHandoffTransaction): IHandoffOutcome {
  return {
    handoffId: transaction.handoffId,
    phase: transaction.phase,
    ...(transaction.refusal !== undefined && { refusal: transaction.refusal }),
    ...(transaction.detail !== undefined && { detail: transaction.detail }),
  };
}

/**
 * Is the SOURCE still authoritative for this session?
 *
 * Delegates to the contract's predicate rather than re-deriving it. Two implementations of "who owns
 * this" is precisely the ambiguity the acceptance criteria forbid, so there is one.
 */
export function sourceStillOwns(transaction: IHandoffTransaction): boolean {
  return sourceRetainsAuthority(transaction.phase);
}
