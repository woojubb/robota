// @robota-sdk/agent-interface-session-mobility
//
// Session mobility: moving MESSAGES between live sessions and AUTHORITY over a session to
// another machine. Owned here rather than by `agent-interface-transport`.
//
// LAYER 2 — the highest in this family. It composes `agent-interface-session`, which composes the
// three layer-0 owners. Nothing names a type from here.
//
// Export each name from its declaring module so interface-runtime can classify it directly.

// ── peer-message-contracts ──
export type {
  IPeerAdmission,
  IPeerMessage,
  IPeerMessageAck,
  IPeerMessageIngress,
  IPeerOrigin,
  ISessionPeerMessagingPort,
  TPeerDeliveryState,
  TPeerTrust,
  TWorkspaceRelation,
} from './peer-message-contracts.js';
export { isSameEnvironmentPeer, isTerminalPeerDelivery } from './peer-message-contracts.js';

// ── mesh-admission-contracts ──
export type { IMeshAdmission, TMeshCapability, TPeerReach } from './mesh-admission-contracts.js';

// ── connection-authority ──
export type {
  IAuthorizeOptions,
  ICapabilityApprovalRequest,
  IConnectionPeer,
  IDelegatedTurn,
  IDelegationRequest,
  IOperatorApprover,
  TCapabilityApproval,
  TCapabilityDecision,
  TCapabilityRefusal,
  TDelegationDecision,
} from './connection-authority.js';
export { ConnectionAuthority, capabilityApproval } from './connection-authority.js';

// ── file-transfer-contracts ──
export type { IFileFrameChannel, IFileOffer } from './file-transfer-contracts.js';

// ── handoff-contracts ──
export type {
  IHandoffCommitAck,
  IHandoffIntegrity,
  IHandoffManifest,
  IHandoffOutcome,
  IHandoffPayload,
  IHandoffStateItem,
  THandoffDisposition,
  THandoffPhase,
  THandoffRefusal,
} from './handoff-contracts.js';
export { isHandoffCommitted, sourceRetainsAuthority } from './handoff-contracts.js';

// ── handoff-ownership ──
export type { ICommitResult, IHandoffTransaction, ITransitionResult } from './handoff-ownership.js';
export {
  advanceHandoff,
  beginHandoff,
  commitHandoff,
  handoffOutcome,
  sourceStillOwns,
} from './handoff-ownership.js';

export type {
  IPrepareHandoffOfferInput,
  ISourceRuntimeState,
  THandoffOfferResult,
  THandoffReadiness,
} from './handoff-offer.js';
export { assessHandoffReadiness, prepareHandoffOffer } from './handoff-offer.js';

// ── handoff orchestration ──
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
  THandoffRecordDecodeOutcome,
} from './handoff-composition.js';
export { HandoffSource } from './handoff-source.js';
export type {
  IHandoffCarrier,
  IHandoffSourceOptions,
  TOfferOutcome,
  TSourceAbandonReason,
} from './handoff-source.js';
export { HandoffDestination } from './handoff-destination.js';
export type {
  IDestinationReport,
  IHandoffDestinationOptions,
  TCredentialResolver,
  TDestinationState,
  TRecordPersister,
} from './handoff-destination.js';
