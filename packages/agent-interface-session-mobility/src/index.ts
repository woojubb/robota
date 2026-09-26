// @robota-sdk/agent-interface-session-mobility
//
// Session mobility: moving MESSAGES between live sessions (PEER-001) and AUTHORITY over a session to
// another machine (HANDOFF-001). Moved out of `agent-interface-transport` by ARCH-107 (issue #2111).
//
// LAYER 2 — the highest in this family. It composes `agent-interface-session`, which composes the
// three layer-0 owners. Nothing names a type from here.
//
// Each name is exported from the module that DECLARES it, not through the sub-barrel that re-exports
// it. Two reasons: `sdk-public-surface` requires explicit named exports so an owner boundary is
// auditable, and `interface-runtime` resolves a re-export one hop to classify what it found —
// a discriminator reached through an intermediate module is reported as a mechanism it cannot see.

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
export type { IHandoffCarrier, IHandoffSourceOptions, TOfferOutcome } from './handoff-source.js';
export { HandoffDestination } from './handoff-destination.js';
export type {
  IDestinationReport,
  IHandoffDestinationOptions,
  TCredentialResolver,
  TDestinationState,
  TRecordPersister,
} from './handoff-destination.js';
