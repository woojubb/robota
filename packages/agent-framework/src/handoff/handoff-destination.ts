/**
 * The DESTINATION half of a session hand-off (HANDOFF-001, issue #1864).
 *
 * Its whole job is to be unable to lie about two things: that the payload it holds is the one that
 * was sent, and that the transfer is on disk before it says so.
 *
 * ## Staged is not live
 *
 * A complete, verified payload puts this end in `staged`, and a staged transfer is inert — the
 * session is not running, and nothing here has told the source anything. That gap exists so the
 * destination can discover it cannot resume BEFORE the source has given up authority. A destination
 * that went live on arrival and then failed to resolve a credential would have taken a session it
 * cannot run, from a machine that had already stopped running it.
 *
 * ## The credential is resolved here, and it is allowed to fail
 *
 * Provider credentials are `never-transferred` (SEC-009: a resolved secret must not cross a process
 * boundary, and a machine boundary is strictly worse). So the destination resolves its OWN, at
 * commit, and a machine without one fails LOUDLY at that moment rather than silently on the user's
 * next turn. That is TC-07, and it is the reason `commit` takes a resolver rather than a flag.
 *
 * ## `persisted` is produced, never assumed
 *
 * The acknowledgement is built from the return of the persist call. There is no path here that
 * emits an ack for a write that did not happen — a source that transitioned on such an ack would
 * hand off to a destination that then crashed before writing.
 */

import type {
  IHandoffAssemblerPort,
  IHandoffChunkFrame,
  IHandoffComposition,
} from './handoff-composition.js';
import type {
  IHandoffCommitAck,
  IHandoffManifest,
  IInteractiveSessionRecord,
  THandoffRefusal,
} from '@robota-sdk/agent-interface-transport';

/** What this end is doing. `staged` is complete and verified; it is NOT live. */
export type TDestinationState = 'idle' | 'receiving' | 'staged' | 'committed' | 'discarded';

export interface IDestinationReport {
  readonly state: TDestinationState;
  readonly refusal?: THandoffRefusal;
  readonly detail?: string;
}

/** Resolve THIS machine's provider credential. Returns false when the machine has none. */
export type TCredentialResolver = () => Promise<boolean> | boolean;

/** Write the transferred session durably. Returns whether it is ON DISK, not whether it was queued. */
export type TRecordPersister = (record: IInteractiveSessionRecord) => Promise<boolean> | boolean;

export interface IHandoffDestinationOptions {
  readonly composition: IHandoffComposition;
  readonly resolveCredential: TCredentialResolver;
  readonly persist: TRecordPersister;
  readonly now?: () => number;
  readonly deviceId: string;
}

export class HandoffDestination {
  private state: TDestinationState = 'idle';
  private manifest: IHandoffManifest | null = null;
  private assembler: IHandoffAssemblerPort | null = null;
  private record: IInteractiveSessionRecord | null = null;
  private ack: IHandoffCommitAck | null = null;
  private report_: IDestinationReport = { state: 'idle' };

  constructor(private readonly options: IHandoffDestinationOptions) {}

  /** Accept the offer and open a staging area for it. One assembler per transfer, as the wire requires. */
  receiveManifest(manifest: IHandoffManifest): IDestinationReport {
    this.manifest = manifest;
    this.assembler = this.options.composition.createAssembler(manifest.handoffId);
    this.state = 'receiving';
    return this.settle({ state: this.state });
  }

  /**
   * Take a chunk. On the last one, verify against the manifest and stage — or discard.
   *
   * Nothing is parsed before the integrity check passes: a destination that has already built the
   * object graph from a corrupt payload has spent the effort the check exists to avoid.
   */
  receiveChunk(chunk: IHandoffChunkFrame): IDestinationReport {
    const manifest = this.requireManifest();
    if (this.assembler === null)
      throw new Error('handoff: no staging area — receiveManifest first.');
    const result = this.assembler.accept(chunk);
    if (result.outcome === 'refused') {
      return this.discard('integrity-failed', `chunk refused: ${result.rejection ?? 'unknown'}`);
    }
    if (result.outcome !== 'complete') return this.settle({ state: this.state });

    const verdict = this.options.composition.verifyPayload(
      result.serialized ?? '',
      manifest.integrity,
    );
    if (!verdict.intact) {
      return this.discard(
        'integrity-failed',
        `payload ${verdict.failure ?? 'failed verification'}: manifest declared ` +
          `${verdict.expectedBytes ?? manifest.integrity.byteLength} byte(s), ${verdict.actualBytes ?? 0} arrived`,
      );
    }
    this.record = JSON.parse(result.serialized ?? '') as IInteractiveSessionRecord;
    this.state = 'staged';
    return this.settle({ state: this.state });
  }

  /**
   * Resolve this machine's credential, write the session, and produce the acknowledgement.
   *
   * Order matters and is the point: credential FIRST, because a destination that persisted and then
   * discovered it cannot run the session would hold a session nobody can use — and the source is
   * still authoritative at that instant only because no ack has been produced yet.
   */
  async commit(): Promise<IDestinationReport> {
    if (this.state !== 'staged') {
      return this.settle({
        state: this.state,
        detail: `commit refused: a transfer in state '${this.state}' has nothing verified to commit`,
      });
    }
    if (!(await this.options.resolveCredential())) {
      // Loud, and at commit. The source has not moved: no acknowledgement exists to move it.
      return this.discard(
        'destination-cannot-resume',
        'this machine resolved no provider credential. Credentials are never transferred ' +
          '(SEC-009), so the destination must supply its own — the session stays on the source.',
      );
    }
    if (!(await this.options.persist(this.requireRecord()))) {
      return this.discard(
        'destination-cannot-resume',
        'the transferred session could not be written durably. No acknowledgement is produced: ' +
          'receipt is not persistence, and a source that moved on this would hand off to nothing.',
      );
    }
    this.state = 'committed';
    this.ack = {
      handoffId: this.requireManifest().handoffId,
      destinationDeviceId: this.options.deviceId,
      persisted: true,
      committedAt: (this.options.now ?? Date.now)(),
    };
    return this.settle({ state: this.state });
  }

  /**
   * The acknowledgement, once one exists.
   *
   * Re-readable on purpose: the window this protocol is built around is exactly the one where the
   * first delivery is lost, and re-sending is how it closes. It is not regenerated — the same ack,
   * so the source's idempotence by `handoffId` has something stable to recognise.
   */
  acknowledgement(): IHandoffCommitAck | null {
    return this.ack;
  }

  /** Throw away a transfer that has not committed. The source is unaffected — it was never told. */
  discard(refusal: THandoffRefusal, detail: string): IDestinationReport {
    if (this.state === 'committed') {
      return this.settle({
        state: this.state,
        detail: 'a committed transfer cannot be discarded — this machine is already live for it',
      });
    }
    this.state = 'discarded';
    this.record = null;
    return this.settle({ state: this.state, refusal, detail });
  }

  /** The staged session, readable only once it is committed. Staged is not live. */
  liveRecord(): IInteractiveSessionRecord | null {
    return this.state === 'committed' ? this.record : null;
  }

  report(): IDestinationReport {
    return this.report_;
  }

  private settle(report: IDestinationReport): IDestinationReport {
    this.report_ = report;
    return report;
  }

  private requireManifest(): IHandoffManifest {
    if (this.manifest === null) throw new Error('handoff: no manifest — receiveManifest first.');
    return this.manifest;
  }

  private requireRecord(): IInteractiveSessionRecord {
    if (this.record === null) throw new Error('handoff: nothing staged to commit.');
    return this.record;
  }
}
