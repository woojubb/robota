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

// RUNTIME-003: one turn at a time. `SessionBusyError` is exported because refusing a concurrent turn
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

// SELFHOST-014: shareable/resumable session artifact envelope + the opt-in sensitive-key scrub (SSOT).
export { serializeSessionArtifact, deserializeSessionArtifact } from './session-artifact.js';
export type { ISerializeSessionArtifactOptions } from './session-artifact.js';
export { SENSITIVE_KEY_PATTERN, isSensitiveKey, scrubSensitiveKeys } from './scrub-sensitive.js';
export type { TScrubbableValue } from './scrub-sensitive.js';

// Session logging
export { FileSessionLogger, SilentSessionLogger } from './session-logger.js';
export {
  createSessionLogExternalPayloadReference,
  NodeSessionLogSink,
} from './session-log-sinks.js';
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
export { NodeExternalPayloadSource, NodeSessionLogSource } from './session-log-sources.js';
export type { INodeExternalPayloadSourceOptions } from './session-log-sources.js';
// Sealed append lines and log sidecars: the one module every append store writes and reads through,
// so a prompt-history file, a log sink and a log source cannot disagree about what a line means.
export { StoredLines, StoredPayloads, splitStoredLines } from './stored-append-lines.js';
export type { IStoredPayloadWrite, TAppendLineKind, TStoredLine } from './stored-append-lines.js';
// #3679: sealing in place what a store kept in plaintext before its host sealed, each converter
// beside the format it converts. Optional additions: nothing else calls them.
export {
  countPlainSessionLogLines,
  sealSessionLogText,
  sealStoredPayloadBytes,
  storedPayloadMigrationState,
} from './stored-append-lines.js';
export type { ISealedSessionLogText, TStoredPayloadMigrationState } from './stored-append-lines.js';
export { migrateSessionLogDirectory } from './session-log-migration.js';
export type {
  IMigrateSessionLogsOptions,
  ISessionLogCatchUpFailure,
  ISessionLogMigration,
} from './session-log-migration.js';
export {
  migrateNodeSessionStore,
  readSessionStoreWorkingDirectories,
} from './session-record-migration.js';
export type {
  IMigrateSessionRecordsOptions,
  ISealedSessionRecord,
  ISessionRecordMigration,
} from './session-record-migration.js';
export {
  NodeToolResultSpillStore,
  ToolResultSpillError,
  sweepStaleToolResultSpillDirectories,
  type INodeToolResultSpillStoreOptions,
  type TToolResultSpillErrorCode,
} from './tool-result-spill-store.js';
export {
  DEFAULT_PROMPT_HISTORY_BLOCK_BYTES,
  NodePromptHistoryFile,
  parsePromptHistoryLine,
} from './prompt-history-file.js';
export type { INodePromptHistoryFileOptions } from './prompt-history-file.js';
export {
  compactPromptHistoryFile,
  inspectPromptHistoryFile,
  readPromptHistoryProjects,
} from './prompt-history-compaction.js';
export type {
  ICompactPromptHistoryOptions,
  IInspectPromptHistoryOptions,
  TPromptHistoryCompaction,
  TPromptHistoryInspection,
  TPromptHistoryRefusal,
} from './prompt-history-compaction.js';
export type { IAppendFileCatchUpFailure } from './append-file-rewrite.js';
export type { IExternalPayloadSource, ISessionLogSource } from './session-log-sources.js';
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

// Session persistence
export { assertSafeSessionId, isSafeSessionId } from './session-id.js';
export { NodeSessionStore } from './session-store.js';
export type { INodeSessionStoreOptions } from './session-store.js';
export { loadSessionForUpdate } from './load-session-for-update.js';
// Sealed session records: the one object both session stores write and read through, so the user's
// directory and the trusted project's cannot disagree about what a sealed or plain file means. A store
// gives it one adapter, `IStoredSessionFiles`, for reaching its files.
export {
  StoredSessionRecords,
  assertSessionSealing,
  sessionSealingOf,
} from './stored-session-record.js';
export type { ISessionStoreOptions, IStoredSessionFiles } from './stored-session-record.js';
export {
  classifyStoredSessionBytes,
  isPlainSessionRecordOf,
  sealStoredSessionBytes,
  storedSessionMigrationState,
} from './stored-session-codec.js';
export type {
  IEncodedSession,
  TStoredSessionFile,
  TStoredSessionMigrationState,
} from './stored-session-codec.js';
export {
  SealedSessionUnreadableError,
  isSealedSessionUnreadableError,
} from './sealed-session-refusal.js';
export type { TSealedSessionRefusal } from './sealed-session-refusal.js';
// Claims: the ids a session in this process runs, answered only from content the owner wrote.
export { SessionClaimedError, isSessionClaimedError } from './session-claims.js';
export type { TSessionClaimRefusal } from './session-claims.js';
export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IInteractiveSessionRecord as ISessionRecord,
  IInteractiveSessionStore as ISessionStore,
} from '@robota-sdk/agent-interface-session';

// SELFHOST-007: neutral checkpoint tree (branching time-travel) — pure, I/O-free.
export { CheckpointTree } from './checkpoint-tree.js';
export type { ICheckpointNode } from './checkpoint-tree.js';

// TRANS-005 (issue #2081): the total runtime decoder for a PERSISTED session record. It lives here,
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
