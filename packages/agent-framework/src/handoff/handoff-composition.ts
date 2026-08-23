/**
 * What the hand-off orchestration needs from the wire layer, as a contract the composition root
 * fills in (HANDOFF-001, issue #1864).
 *
 * The manifest builder, the integrity seal, the chunker and the ownership transaction all live in
 * `@robota-sdk/agent-transport-protocol`, which is the wire SSOT. Orchestration lives here, with the
 * session whose authority is being moved. Those are two packages, and the edge between them is the
 * decision this file records.
 *
 * `agent-framework` does NOT take a dependency on the wire package. Every consumer of
 * `agent-transport-protocol` today is either a transport package or the composition root, and the
 * repository's own recent direction is to REMOVE such edges from assembly packages rather than add
 * them — ARCH-021 deleted `agent-subagent-runner`'s `agent-builtin-providers` dependency for exactly
 * this reason and had the composition root supply `ISubagentWorkerComposition` instead. This is that
 * shape again.
 *
 * The methods are narrow on purpose. A port that took the whole wire module would let a later change
 * reach anything in it, and the point of naming five operations is that the orchestration below can
 * be read without reading the wire package at all.
 */

import type {
  IHandoffIntegrity,
  IHandoffManifest,
  IInteractiveSessionRecord,
  THandoffPhase,
  THandoffRefusal,
} from '@robota-sdk/agent-interface-transport';

/** What the source knows about work that has not settled. Mirrors the wire package's input shape. */
export interface IHandoffRuntimeState {
  readonly modelCallInFlight?: boolean;
  readonly toolCallsInFlight?: number;
  readonly subprocesses?: number;
  readonly uncommittedChanges?: boolean;
}

export interface IHandoffManifestRequest {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  readonly record: IInteractiveSessionRecord;
  readonly runtime: IHandoffRuntimeState;
  readonly offeredAt: number;
}

export type TManifestOutcome =
  | { readonly built: true; readonly manifest: IHandoffManifest; readonly serialized: string }
  | { readonly built: false; readonly refusal: THandoffRefusal; readonly detail: string };

/** One piece of a payload in flight. Structurally the wire package's `IHandoffChunk`. */
export interface IHandoffChunkFrame {
  readonly handoffId: string;
  readonly index: number;
  readonly total: number;
  readonly data: string;
}

export interface IIntegrityOutcome {
  readonly intact: boolean;
  readonly failure?: 'truncated' | 'digest-mismatch';
  readonly expectedBytes?: number;
  readonly actualBytes?: number;
}

/** A transfer's state as the source sees it. The orchestration reads it; it never writes the phase. */
export interface IHandoffTransactionState {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly phase: THandoffPhase;
  readonly refusal?: THandoffRefusal;
  readonly detail?: string;
}

export interface ITransitionOutcome {
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface ICommitOutcome extends ITransitionOutcome {
  readonly duplicate?: boolean;
}

/**
 * The ownership transaction, as the orchestration uses it.
 *
 * Deliberately an object with methods rather than five loose functions: a transaction is one thing
 * with one identity, and handing the orchestration the pieces separately would let a caller advance
 * one transaction with another's acknowledgement.
 */
export interface IHandoffTransactionPort {
  readonly state: IHandoffTransactionState;
  advance(
    next: THandoffPhase,
    detail?: { refusal?: THandoffRefusal; detail?: string },
  ): ITransitionOutcome;
  /** Apply the destination's durable acknowledgement. The only path to `committed`. */
  commit(ack: {
    readonly handoffId: string;
    readonly destinationDeviceId: string;
    readonly persisted: true;
    readonly committedAt: number;
  }): ICommitOutcome;
  /** Is the SOURCE still authoritative? Never re-derived here — two answers is the ambiguity. */
  sourceStillOwns(): boolean;
}

/** The wire operations the orchestration composes. Supplied by the composition root. */
export interface IHandoffComposition {
  buildManifest(request: IHandoffManifestRequest): TManifestOutcome;
  beginTransaction(manifest: IHandoffManifest): IHandoffTransactionPort;
  chunk(handoffId: string, serialized: string): readonly IHandoffChunkFrame[];
  verifyPayload(serialized: string, integrity: IHandoffIntegrity): IIntegrityOutcome;
  /** A fresh assembler for ONE transfer. One per `handoffId`, as the wire package requires. */
  createAssembler(handoffId: string): IHandoffAssemblerPort;
}

export interface IAssembleOutcome {
  readonly outcome: 'accepted' | 'duplicate' | 'complete' | 'refused';
  readonly rejection?: string;
  readonly serialized?: string;
  readonly received: number;
  readonly expected?: number;
}

export interface IHandoffAssemblerPort {
  accept(chunk: IHandoffChunkFrame): IAssembleOutcome;
}
