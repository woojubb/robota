/**
 * The three-tier identity model: master key (recomputed from a recovery phrase, never stored) →
 * signing key (day-to-day issuer) → device certificates, roster and revocation lists. Every
 * signature carries its purpose.
 */
export { IDENTITY_CLOCK_SKEW_MS, IDENTITY_PURPOSES } from './encoding.js';
export type { TIdentityPurpose, TSignatureAlg } from './encoding.js';
export {
  MASTER_KEY_DERIVATION_PATH,
  RECOVERY_PHRASE_WORDS,
  deriveMasterKey,
  generateRecoveryPhrase,
  validateRecoveryPhrase,
} from './master-key.js';
export type {
  IMasterKey,
  TRecoveryPhraseRejection,
  TRecoveryPhraseVerdict,
} from './master-key.js';
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
} from './certificates.js';
export type {
  ICertifyDeviceOptions,
  ICertifySigningKeyOptions,
  IDeviceCertificate,
  ISigningKey,
  ISigningKeyCertificate,
  TDeviceCapability,
} from './certificates.js';
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
} from './statements.js';
export type {
  IDeviceRevocationList,
  IDeviceRoster,
  IIssueRevocationListOptions,
  IIssueRosterOptions,
  IIssueSigningKeyRevocationOptions,
  ISessionDescriptor,
  ISignSessionDescriptorOptions,
  ISigningKeyRevocation,
} from './statements.js';
export { verifyDeviceChain, verifySessionDescriptor } from './verify-chain.js';
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
} from './verify-chain.js';
