// Utility exports
//
// `path-containment` is NOT here: it imports `node:fs` and `node:path`, and this barrel feeds the
// BROWSER build too. It is exported from `@robota-sdk/agent-core/node`, which is how a
// consumer asks for it — the subpath, not a relative path that depends on where you are reading.
export { createAbortError, isAbortFailure } from './abort-classification';
export * from './message-converter';
export * from './logger';
export * from './validation';
export * from './error-utils';
export * from './errors';
export { ExecutionJournalError } from './execution-journal-error';
export { ExecutionSuspendedError } from './execution-suspended-error';
export { isExecutionControlError } from './execution-control-error';
export {
  classifyProviderFailure,
  readProviderFailureDetails,
  scrubSecrets,
  toProviderError,
  type IProviderFailureClassification,
  type TProviderFailureReason,
} from './provider-failure';
export * from './periodic-task';
export {
  buildTraceparent,
  isMintedSpanId,
  outboundTraceContextFor,
  providerCallSpanId,
  spanIdFromMintedId,
  subprocessTraceEnvironment,
  toolTraceContextFor,
  traceEnvFor,
  traceHeadersFor,
} from './trace-context';
export type { TTimerId } from './timer-types';
export { ExecutionRecoveryError } from './execution-recovery-error';
export type { TExecutionRecoveryErrorCode } from './execution-recovery-error';
export {
  ArtifactCorruptError,
  ArtifactLockedError,
  isArtifactCorruptError,
  isArtifactLockedError,
} from './artifact-sealer-errors';
export type { TArtifactLockedReason, TArtifactSealerErrorCode } from './artifact-sealer-errors';
export {
  SEALED_ARTIFACT_LINE_PREFIX,
  SEALED_ARTIFACT_MAGIC,
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
  isCurrentSealedArtifactBytes,
  isCurrentSealedArtifactLine,
  isSealedArtifactBytes,
  isSealedArtifactLine,
} from './sealed-artifact-framing';
