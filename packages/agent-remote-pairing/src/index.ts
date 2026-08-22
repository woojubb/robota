/**
 * `@robota-sdk/agent-remote-pairing` — isomorphic pairing + DTLS-fingerprint channel binding for REMOTE-001
 * P2P remote-control (REMOTE-005 Stage B3). WebCrypto only; reused by the Node host and the Stage-D browser
 * remote client. No user-facing enable path here (that is Stage B4).
 */
export {
  generatePairingSecret,
  generateNonce,
  toPairingUrl,
  parsePairingUrl,
  extractDtlsFingerprint,
  deriveSessionKey,
  computeConfirmations,
  verifyPeerConfirmation,
} from './pairing.js';
export type { IPairingSecret, IConfirmationInput, TPairingRole } from './pairing.js';
export { startPairingHandshake } from './handshake.js';
export type { IPairingHandshakeOptions, IPairingResult, TPairingFrame } from './handshake.js';
export {
  generateIdentityKeyPair,
  exportPublicKey,
  importPublicKey,
  exportKeyPairJwk,
  importKeyPairJwk,
  deriveIdentityId,
  signChallenge,
  verifyChallenge,
} from './device-identity.js';
export type { IIdentityKeyPairJwk, IReconnectChallenge } from './device-identity.js';
export { deriveReconnectSeed, deriveReconnectRendezvous } from './reconnect-rendezvous.js';
export { startDeviceReconnect, startHostReconnect } from './reconnect.js';
export type {
  IReconnectController,
  IReconnectResult,
  IDeviceReconnectOptions,
  IHostReconnectOptions,
  TReconnectFrame,
} from './reconnect.js';

// SEC-011 (#1812): same-USER proof across two computers. Distinct from device identity above —
// a key identifies a machine, and a machine is not a person. The user holds one root that signs
// each device key, so the proof travels WITH the destination rather than being asserted by the
// source (which would be an authorization list wearing an authentication's clothes).
export {
  deriveUserId,
  generateUserRootKeyPair,
  issueDeviceCertificate,
  verifyDeviceCertificate,
  verifyDevicePossession,
} from './user-identity.js';
export type {
  ICertificateVerification,
  IIssueCertificateOptions,
  IUserDeviceCertificate,
  IVerifyCertificateOptions,
  TCertificateRejection,
} from './user-identity.js';
export { issueHandoffGrant, verifyHandoffGrant } from './handoff-authorization.js';
export type {
  IHandoffAuthorization,
  IHandoffGrant,
  IHandoffGrantClaims,
  IVerifyGrantOptions,
  TGrantRejection,
} from './handoff-authorization.js';
// SEC-011 (issue #1865): how a revocation reaches the machine doing the checking. Signed by the same
// user root as a certificate, so distribution needs no trusted channel — and bounded by an expiry,
// because a stale list is indistinguishable from one an attacker withheld.
export {
  issueRevocationList,
  revocationUnavailable,
  verifyRevocationList,
} from './revocation-list.js';
export type {
  IRevocationList,
  IRevocationListClaims,
  IRevocationVerdict,
  IVerifyRevocationListOptions,
  TRevocationRejection,
} from './revocation-list.js';
// SEC-011 (issue #1865): rotating the user root. Hygiene only — a COMPROMISED root is abandoned, not
// rotated, because an attacker holding it can sign the same statement. See the module header.
export {
  issueRootRotation,
  previousRootStillAccepted,
  verifyRootRotation,
} from './root-rotation.js';
export type {
  IIssueRotationOptions,
  IRootRotation,
  IRootRotationClaims,
  IRotationVerdict,
  IVerifyRotationOptions,
  TRotationRejection,
} from './root-rotation.js';
