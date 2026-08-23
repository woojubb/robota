/**
 * The contracts for moving work BETWEEN sessions — a sub-barrel, so the root barrel stays under the
 * anti-monolith limit as this axis grows.
 *
 * Two features, one axis: PEER-001 (#1809) moves MESSAGES between two live sessions, and
 * HANDOFF-001 (#1811) moves AUTHORITY over one session to another machine. They are grouped because
 * a reader asking "how does one session reach another" should find both in one place, and because
 * they share the rule that a surface which merely LOOKS similar is not the same contract:
 * `TClientMessage.submit` is not a peer message, and `SessionResumeBridge` is not a hand-off.
 */
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
