export {
  bearerCredential,
  credentialMatches,
  mintTransportToken,
  resolveAdmission,
} from './admission.js';
export {
  buildHandoffManifest,
  sealHandoffRecord,
  verifyHandoffPayload,
} from './handoff-manifest.js';
export type {
  IBuildManifestInput,
  IIntegrityVerdict,
  ISourceRuntimeState,
  TIntegrityFailure,
  TManifestResult,
} from './handoff-manifest.js';
