/**
 * Session hand-off orchestration (HANDOFF-001, issue #1864).
 *
 * The two ends and the contract the composition root fills in. The wire operations themselves live
 * in `@robota-sdk/agent-transport-protocol`; see `handoff-composition.ts` for why the edge runs
 * through a port rather than a dependency.
 */

export type {
  IAssembleOutcome,
  ICommitOutcome,
  IHandoffAssemblerPort,
  IHandoffChunkFrame,
  IHandoffComposition,
  IHandoffManifestRequest,
  IHandoffRuntimeState,
  IHandoffTransactionPort,
  IHandoffTransactionState,
  IIntegrityOutcome,
  ITransitionOutcome,
  TManifestOutcome,
} from './handoff-composition.js';
export { HandoffSource } from './handoff-source.js';
export type { IHandoffCarrier, IHandoffSourceOptions, TOfferOutcome } from './handoff-source.js';
export { HandoffDestination } from './handoff-destination.js';
export type {
  IDestinationReport,
  IHandoffDestinationOptions,
  TCredentialResolver,
  TDestinationState,
  TRecordPersister,
} from './handoff-destination.js';
