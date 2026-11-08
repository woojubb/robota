// @robota-sdk/agent-session

// Session
export type { TSessionResumeOptions } from './session-resume.js';
export type {
  ISessionPendingExecution,
  ISessionRecoverableRunOptions,
  TSessionRecoverableResumeOptions,
  TSessionExecutionResult,
} from './session-recoverable.js';
export { Session } from './session.js';
export type { IProviderCallTraceObservation, ISessionRunOptions } from './session-types.js';
export type {
  ISessionOptions,
  ISessionShutdownOptions,
  TAutoCompactThreshold,
  TPermissionHandler,
  TPermissionResult,
  IPermissionAskContext,
  TPermissionRequester,
  ITerminalOutput,
  ISpinner,
} from './session.js';

// One turn at a time. `SessionBusyError` is exported because refusing a concurrent turn
// is part of `run()`'s contract, and a consumer that cannot identify the refusal has to keep the
// busy flag this change exists to remove.
export { SessionBusyError, TurnClaim } from './turn-claim.js';

// Sub-components (exported for advanced use cases)
export { PermissionEnforcer } from './permission-enforcer.js';
export { consentScopeFor } from './consent-scope.js';
export type { IPermissionDenial, TPermissionDenialReason } from './permission-denial-log.js';
export type { ICommandSandboxApproval } from './permission-types.js';
export { AutoModeGate, CONSECUTIVE_BLOCK_LIMIT, TOTAL_BLOCK_LIMIT } from './auto-mode-gate.js';
export type {
  IClassifiedCall,
  IClassifierVerdict,
  IPermissionClassifier,
  TAutoModeJudgement,
} from './auto-mode-gate.js';
export { AUTO_COMPACT_THRESHOLD, ContextWindowTracker } from './context-window-tracker.js';
export {
  CompactionError,
  CompactionOrchestrator,
  DEFAULT_COMPACTION_PROMPT,
} from './compaction-orchestrator.js';
export { formatConversationEntries } from './conversation-transcript.js';

// Shareable/resumable session artifact envelope + the opt-in sensitive-key scrub (SSOT).
export { serializeSessionArtifact, deserializeSessionArtifact } from './session-artifact.js';
export type { ISerializeSessionArtifactOptions } from './session-artifact.js';
export { SENSITIVE_KEY_PATTERN, isSensitiveKey, scrubSensitiveKeys } from './scrub-sensitive.js';
export type { TScrubbableValue } from './scrub-sensitive.js';

// Session logging
export { FileSessionLogger, SilentSessionLogger } from './session-logger.js';
export { createSessionLogExternalPayloadReference } from './session-log-sinks.js';
export type { IExternalPayloadSink, ISessionLogSink } from './session-log-sinks.js';
export {
  SESSION_LOG_EVENT,
  SESSION_LOG_SCHEMA_VERSION,
  isSessionLogEvent,
} from './session-log-events.js';
export { decodeSessionLogEntries, SessionLogDecodeError } from './session-log-codec/index.js';
export type {
  TDecodedSessionLogEntry,
  TSessionLogDecodeErrorCode,
} from './session-log-codec/index.js';
export type {
  TSessionLogEventName,
  ISessionLogLine,
  IProviderEventKey,
  IToolEventKey,
} from './session-log-events.js';
export type {
  IExternalPayloadReference,
  IFileSessionLoggerOptions,
  ISessionLogger,
  TSessionLogData,
  TSessionLogValue,
} from './session-logger.js';
export type { IExternalPayloadSource, ISessionLogSource } from './external-payload-source-types.js';
export {
  resolveSessionLogExternalPayloads,
  SessionLogPayloadResolutionError,
} from './external-payload-resolver.js';
export type {
  ISessionLogPayloadResolutionErrorMetadata,
  ISessionLogPayloadResolutionOptions,
  TSessionLogPayloadResolutionErrorCode,
} from './external-payload-resolver.js';
export {
  loadSessionLogEntries,
  replaySessionLogEntries,
  validateSessionReplayLogEntries,
} from './session-log-replay.js';
export type {
  ISessionLogEntry,
  ISessionLogLoadOptions,
  ISessionReplayRecord,
  ISessionReplayValidationIssue,
  ISessionReplayValidationResult,
} from './session-log-replay.js';

// Session persistence — the file-backed store is `NodeSessionStore` in `@robota-sdk/agent-session/node`.
export { assertSafeSessionId, isSafeSessionId } from './session-id.js';
export { loadSessionForUpdate } from './load-session-for-update.js';
export {
  SealedSessionUnreadableError,
  isSealedSessionUnreadableError,
} from './sealed-session-refusal.js';
export type { TSealedSessionRefusal } from './sealed-session-refusal.js';
// Claims: the ids a session in this process runs, answered only from content the owner wrote.
export { SessionClaimedError, isSessionClaimedError } from './session-claims.js';
export type { ISessionWriterHolder, TSessionClaimRefusal } from './session-claims.js';
export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IInteractiveSessionRecord as ISessionRecord,
  IInteractiveSessionStore as ISessionStore,
} from '@robota-sdk/agent-interface-session';

// Neutral checkpoint tree (branching time-travel) — pure, I/O-free.
export { CheckpointTree } from './checkpoint-tree.js';
export type { ICheckpointNode } from './checkpoint-tree.js';

// The total runtime decoder for a PERSISTED session record. It lives here,
// beside the store and artifact paths that will consume it, rather than with the contract it decodes:
// the interface package owns the record shape, while this package owns the decoding mechanism.
export {
  INTERACTIVE_SESSION_RECORD_KEYS,
  SESSION_RECORD_ENVELOPE_VERSION,
  decodeInteractiveSessionRecord,
  decodeVersionedInteractiveSessionRecord,
} from './session-record-codec/index.js';
export type {
  IVersionedInteractiveSessionRecord,
  TSessionRecordDecodeOutcome,
} from './session-record-codec/index.js';
