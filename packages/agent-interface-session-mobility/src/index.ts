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
} from './peer-message-contracts.js';
export { isSameEnvironmentPeer, isTerminalPeerDelivery } from './peer-message-contracts.js';

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
