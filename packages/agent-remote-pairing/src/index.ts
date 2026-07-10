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
