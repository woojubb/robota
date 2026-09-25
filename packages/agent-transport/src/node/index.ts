export {
  bearerCredential,
  credentialMatches,
  mintTransportToken,
  resolveAdmission,
} from './admission.js';
export { sealHandoffRecord, verifyHandoffPayload } from './handoff-manifest.js';
export type { IIntegrityVerdict, TIntegrityFailure } from './handoff-manifest.js';
export { createAccessTokenVerifier } from './access-token-verifier.js';
export type { IAccessTokenVerifierDeps } from './access-token-verifier.js';
