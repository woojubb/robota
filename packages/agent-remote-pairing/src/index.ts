/**
 * `@robota-sdk/agent-remote-pairing` — isomorphic pairing + DTLS-fingerprint channel binding for
 * P2P
 * remote-control. WebCrypto only; reused by the Node host and the browser remote client. No
 * user-facing enable path here.
 */
export {
  generatePairingSecret,
  generateNonce,
  toPairingUrl,
  parsePairingUrl,
  extractDtlsFingerprint,
  extractDtlsFingerprintAttribute,
  deriveSessionKey,
  computeConfirmations,
  verifyPeerConfirmation,
} from './pairing.js';
export type {
  IDtlsFingerprint,
  IPairingSecret,
  IConfirmationInput,
  TPairingRole,
} from './pairing.js';
export { startPairingHandshake } from './handshake.js';
export type { IPairingHandshakeOptions, IPairingResult, TPairingFrame } from './handshake.js';
// The pre-auth frame vocabulary is decoded HERE, totally, and both carriers import it.
export {
  PRE_AUTH_FRAME_LIMITS,
  decodeEnrollFrame,
  decodePairingFrame,
  decodeReconnectFrame,
} from './frame-codec.js';
export type { IEnrollFrame, TFrameDecodeResult, TPreAuthFrame } from './frame-codec.js';
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

export { issueHandoffGrant, verifyHandoffGrant } from './handoff-authorization.js';
export type {
  IHandoffAuthorization,
  IHandoffGrant,
  IHandoffGrantClaims,
  IVerifyGrantOptions,
  TGrantRejection,
} from './handoff-authorization.js';
// Same-USER proof across two computers: a three-tier identity chain (master → signing key →
// device) with purpose-tagged signatures. A key identifies a machine and a machine is not a person,
// so the user's master key certifies signing keys, which certify the devices, and the proof travels
// WITH the destination rather than being asserted by the source.
export { IDENTITY_CLOCK_SKEW_MS } from './identity/encoding.js';
export type { TIdentityPurpose, TSignatureAlg } from './identity/encoding.js';
export {
  RECOVERY_PHRASE_WORDS,
  deriveMasterKey,
  generateRecoveryPhrase,
  isRecoveryPhraseWord,
  validateRecoveryPhrase,
} from './identity/master-key.js';
export type {
  IDeriveMasterKeyOptions,
  IMasterKey,
  TRecoveryPhraseRejection,
  TRecoveryPhraseVerdict,
} from './identity/master-key.js';
export {
  DEVICE_CAPABILITIES,
  DEVICE_CERTIFICATE_VALIDITY_MS,
  DEVICE_NAME_MAX_CHARS,
  SIGNING_KEY_CERTIFICATE_VALIDITY_MS,
  certifyDevice,
  certifySigningKey,
  decodeDeviceCertificate,
  decodeSigningKeyCertificate,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateSigningKeyPair,
} from './identity/certificates.js';
export type {
  ICertifyDeviceOptions,
  ICertifySigningKeyOptions,
  IDeviceCertificate,
  ISigningKey,
  ISigningKeyCertificate,
  TDeviceCapability,
} from './identity/certificates.js';
export {
  IDENTITY_STATEMENT_LIMITS,
  REVOCATION_LIST_VALIDITY_MS,
  ROSTER_VALIDITY_MS,
  SESSION_DESCRIPTOR_VALIDITY_MS,
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSessionDescriptor,
  decodeSigningKeyRevocation,
  issueDeviceRevocationList,
  issueDeviceRoster,
  issueSigningKeyRevocation,
  signSessionDescriptor,
} from './identity/statements.js';
export type {
  IDeviceRevocationList,
  IDeviceRoster,
  IIssueRevocationListOptions,
  IIssueRosterOptions,
  IIssueSigningKeyRevocationOptions,
  ISessionDescriptor,
  ISignSessionDescriptorOptions,
  ISigningKeyRevocation,
} from './identity/statements.js';
export { verifyDeviceChain, verifySessionDescriptor } from './identity/verify-chain.js';
export type {
  IChainRejection,
  IDeviceListMarks,
  IListHighWaterMarks,
  IRequiredLists,
  IVerifyDeviceChainInput,
  IVerifySessionDescriptorOptions,
  TChainRejection,
  TChainSubject,
  TDeviceChainVerdict,
  TSessionDescriptorVerdict,
  TSessionRejection,
} from './identity/verify-chain.js';
// The device handshake: two of one user's devices admit each other over a channel bound to its
// negotiated DTLS fingerprints, starting from a pairwise pre-proof that discloses no identity.
export { derivePairwiseSecret } from './identity/pairwise-secret.js';
export type { IDerivePairwiseSecretInput } from './identity/pairwise-secret.js';
export {
  RENDEZVOUS_EPOCH_MS,
  derivePairRendezvous,
  rendezvousEpoch,
} from './identity/rendezvous.js';
export type {
  IDerivePairRendezvousInput,
  IPairRendezvous,
  IRelayInboxTopics,
  IRendezvousLists,
  TRendezvousDirection,
  TRendezvousRecordPurpose,
  TRendezvousTagPurpose,
} from './identity/rendezvous.js';
export {
  DEVICE_HANDSHAKE_PROTOCOL,
  decodeDeviceHandshakeFrame,
} from './identity/device-handshake-frames.js';
export type {
  IDeviceHelloFrame,
  IDeviceNonceFrame,
  IDevicePreFrame,
  IDeviceProveFrame,
  TDeviceFrameDecodeResult,
  TDeviceHandshakeFrame,
} from './identity/device-handshake-frames.js';
export {
  DeviceHandshakeError,
  FRESHNESS_LOOKUP_MS,
  REMOTE_ADMISSION_GRACE_MS,
  startDeviceHandshake,
} from './identity/device-handshake.js';
export type {
  IDeviceHandshakeController,
  IDeviceHandshakeIdentity,
  IDeviceHandshakeOptions,
  IDeviceHandshakeResult,
  IDeviceMeshAdmission,
  IListUpdate,
  TDeviceHandshakeRefusal,
  TListFreshness,
  TMeshLocality,
} from './identity/device-handshake.js';
// Enrolling a new device from a one-time code, proven over the negotiated channel before anything
// else crosses it, and confirmed by both operators with a short authentication string.
export {
  EnrollmentError,
  decodeEnrollmentFrame,
  deriveEnrollmentMaterial,
  enrollmentCommitment,
  enrollmentSas,
  generateEnrollmentCode,
  newEnrollmentContribution,
  normalizeEnrollmentCode,
  signEnrollmentRequest,
  startEnrollmentProof,
  verifyEnrollmentRequest,
  verifyEnrollmentReveal,
} from './identity/enrollment.js';
export type {
  IEnrollmentAnchorFrame,
  IEnrollmentBinding,
  IEnrollmentGrantFrame,
  IEnrollmentMaterial,
  IEnrollmentProofController,
  IEnrollmentProofOptions,
  IEnrollmentRequestFields,
  IEnrollmentRequestFrame,
  IEnrollmentRevealFrame,
  TEnrollmentFrame,
  TEnrollmentFrameDecodeResult,
  TEnrollmentProofFrame,
  TEnrollmentRefusal,
  TEnrollmentRole,
} from './identity/enrollment.js';

export { createIdentityContext } from './identity/crypto-context.js';
export type { IIdentityContext } from './identity/crypto-context.js';
