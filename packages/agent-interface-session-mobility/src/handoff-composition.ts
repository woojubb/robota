/**
 * What the hand-off orchestration needs from the wire layer, as a contract the composition root
 * fills in (HANDOFF-001, issue #1864).
 *
 * Session mobility owns offer and authority decisions. Transport owns the integrity seal and
 * chunker. Orchestration lives here, with the session whose authority is being moved; the CLI
 * composition root supplies both collaborators.
 *
 * Mobility does not depend on the wire package or the session-record decoder. The host supplies
 * those effects while mobility alone applies offer and authority decisions.
 *
 * The methods are narrow on purpose. A port that took the whole wire module would let a later change
 * reach anything in it, and the point of naming five operations is that the orchestration below can
 * be read without reading the wire package at all.
 */

import type {
  IInteractiveSessionRecord,
  ISessionRecordDecodeIssue,
} from '@robota-sdk/agent-interface-session';
import type { IHandoffIntegrity, THandoffPhase, THandoffRefusal } from './handoff-contracts.js';
import type { ISourceRuntimeState } from './handoff-offer.js';

/** What the source knows about work that has not settled. */
export type IHandoffRuntimeState = ISourceRuntimeState;

export interface IHandoffManifestRequest {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  readonly record: IInteractiveSessionRecord;
  readonly runtime: IHandoffRuntimeState;
  readonly offeredAt: number;
}

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

/** Wire and decoder effects supplied by the composition root. */
export interface IHandoffComposition {
  sealRecord(record: IInteractiveSessionRecord): { readonly serialized: string; readonly integrity: IHandoffIntegrity };
  chunk(handoffId: string, serialized: string): readonly IHandoffChunkFrame[];
  verifyPayload(serialized: string, integrity: IHandoffIntegrity): IIntegrityOutcome;
  /** A fresh assembler for ONE transfer. One per `handoffId`, as the wire package requires. */
  createAssembler(handoffId: string): IHandoffAssemblerPort;
  decodeRecord(value: unknown): THandoffRecordDecodeOutcome;
}

/** The session owner's decoder result, supplied by the host after payload integrity is verified. */
export type THandoffRecordDecodeOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  | { readonly status: 'corrupt'; readonly issues: readonly ISessionRecordDecodeIssue[] }
  | { readonly status: 'unsupported'; readonly schemaVersion: number | undefined };

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
