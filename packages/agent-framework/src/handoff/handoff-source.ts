/**
 * The SOURCE half of a session hand-off (HANDOFF-001, issue #1864).
 *
 * The wire layer decides what a phase transition is allowed to be. This decides WHEN to ask for one,
 * and it holds exactly one rule:
 *
 *   **the source gives up authority only on evidence it holds.**
 *
 * Every failure resolves the same way — the source stays authoritative — so the network window
 * between the destination persisting and the source learning of it does not have to be closed. It
 * has to be harmless, and it is: a re-delivered acknowledgement finishes the job, and a lost one
 * leaves a session that still works on the machine the user is sitting at.
 *
 * WHAT THIS DOES NOT DO. It does not send. A carrier is passed in, so that a transfer can be driven
 * over WebRTC in production and over two in-process ends in a test without the orchestration
 * knowing which — and TC-10 is precisely the case that needs the second.
 */

import type {
  IHandoffChunkFrame,
  IHandoffComposition,
  IHandoffManifestRequest,
  IHandoffTransactionPort,
} from './handoff-composition.js';
import type {
  IHandoffCommitAck,
  IHandoffManifest,
  IHandoffOutcome,
} from '@robota-sdk/agent-interface-transport';

/** Where the frames go. The orchestration never learns what is underneath. */
export interface IHandoffCarrier {
  sendManifest(manifest: IHandoffManifest): Promise<void>;
  sendChunk(chunk: IHandoffChunkFrame): Promise<void>;
}

export interface IHandoffSourceOptions {
  readonly composition: IHandoffComposition;
  readonly carrier: IHandoffCarrier;
  /**
   * Called when the source stops being authoritative. The session's own read-only transition.
   *
   * Invoked ONCE, and only after a durable acknowledgement has been applied — never on send, never
   * on receipt. A duplicate acknowledgement does not call it again, because the second call would
   * be a second transition out of a state that is already terminal.
   */
  readonly onReadOnly: () => void;
}

/** Why an offer never became a transfer. Distinct from a refusal so a caller can tell them apart. */
export type TOfferOutcome =
  | { readonly started: true; readonly transaction: IHandoffTransactionPort }
  | { readonly started: false; readonly outcome: IHandoffOutcome };

export class HandoffSource {
  private transaction: IHandoffTransactionPort | null = null;
  private manifestValue: IHandoffManifest | null = null;
  private serialized: string | null = null;
  private readOnlyAnnounced = false;

  constructor(private readonly options: IHandoffSourceOptions) {}

  /**
   * Build the manifest and, if the session is transferable, open the transaction.
   *
   * The refusal comes from the manifest builder rather than being re-decided here. A turn in flight
   * has an outcome that belongs in the history being transferred, and the builder is what knows
   * that — asking twice is how two answers to "is this transferable" come to exist.
   */
  offer(request: IHandoffManifestRequest): TOfferOutcome {
    const built = this.options.composition.buildManifest(request);
    if (!built.built) {
      return {
        started: false,
        outcome: {
          handoffId: request.handoffId,
          phase: 'abandoned',
          refusal: built.refusal,
          detail: built.detail,
        },
      };
    }
    this.transaction = this.options.composition.beginTransaction(built.manifest);
    this.manifestValue = built.manifest;
    this.serialized = built.serialized;
    return { started: true, transaction: this.transaction };
  }

  /**
   * Send the manifest and the payload.
   *
   * The phase moves to `transferring` BEFORE the first frame leaves. A source that sent first and
   * transitioned after would, on a crash between the two, hold a transaction in `offered` while the
   * destination had already begun receiving — and the destination's discard is keyed on a transfer
   * the source would then not know it had started.
   */
  async transfer(): Promise<IHandoffOutcome> {
    const transaction = this.requireTransaction();
    const moved = transaction.advance('transferring');
    if (!moved.accepted) return this.outcomeOf(transaction, 'cancelled', moved.reason);

    const serialized = this.serialized;
    if (serialized === null) {
      // Unreachable through `offer`, which sets both together. Stated rather than assumed: a
      // transfer of an absent payload would send zero chunks, and zero chunks is indistinguishable
      // from a transfer that has not started yet.
      throw new Error(
        'handoff: transfer() called with no sealed payload — offer() must run first.',
      );
    }

    await this.options.carrier.sendManifest(this.manifest());
    for (const chunk of this.options.composition.chunk(transaction.state.handoffId, serialized)) {
      await this.options.carrier.sendChunk(chunk);
    }
    return this.outcome(transaction);
  }

  /**
   * Apply the destination's acknowledgement. The ONLY thing that moves this source to read-only.
   *
   * Re-delivery is the SUCCESSFUL case of the window this protocol is built around, so a duplicate
   * is accepted and reported as one — not as an error, and not as a second transition.
   */
  applyAck(ack: IHandoffCommitAck): IHandoffOutcome {
    const transaction = this.requireTransaction();
    // `staged` is the source's record that the destination reported a verified, complete payload.
    // The wire transaction refuses `transferring → committed`, so a source that never observed the
    // staged report cannot be moved by an acknowledgement alone.
    if (transaction.state.phase === 'transferring') transaction.advance('staged');
    const committed = transaction.commit(ack);
    if (!committed.accepted) return this.outcomeOf(transaction, undefined, committed.reason);
    if (!this.readOnlyAnnounced) {
      this.readOnlyAnnounced = true;
      this.options.onReadOnly();
    }
    return this.outcome(transaction);
  }

  /** Give up, at any phase before `committed`. The session stays usable and authoritative. */
  abandon(
    reason: 'cancelled' | 'timed-out' | 'destination-cannot-resume',
    detail?: string,
  ): IHandoffOutcome {
    const transaction = this.requireTransaction();
    transaction.advance('abandoned', { refusal: reason, ...(detail !== undefined && { detail }) });
    return this.outcome(transaction);
  }

  /** Is this machine still in charge of the session? */
  isAuthoritative(): boolean {
    return this.transaction === null ? true : this.transaction.sourceStillOwns();
  }

  private manifest(): IHandoffManifest {
    if (this.manifestValue === null)
      throw new Error('handoff: no manifest — offer() must run first.');
    return this.manifestValue;
  }

  private requireTransaction(): IHandoffTransactionPort {
    if (this.transaction === null) {
      throw new Error('handoff: no transfer is open — offer() must run first.');
    }
    return this.transaction;
  }

  private outcome(transaction: IHandoffTransactionPort): IHandoffOutcome {
    return this.outcomeOf(transaction);
  }

  private outcomeOf(
    transaction: IHandoffTransactionPort,
    refusal?: IHandoffOutcome['refusal'],
    detail?: string,
  ): IHandoffOutcome {
    const state = transaction.state;
    return {
      handoffId: state.handoffId,
      phase: state.phase,
      ...((refusal ?? state.refusal) !== undefined && { refusal: refusal ?? state.refusal }),
      ...((detail ?? state.detail) !== undefined && { detail: detail ?? state.detail }),
    };
  }
}
