// @robota-sdk/agent-session

// Session
export { Session } from './session.js';
export type {
  ISessionOptions,
  ISessionShutdownOptions,
  TAutoCompactThreshold,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './session.js';

// RUNTIME-003: one turn at a time. `SessionBusyError` is exported because refusing a concurrent turn
// is part of `run()`'s contract, and a consumer that cannot identify the refusal has to keep the
// busy flag this change exists to remove.
export { SessionBusyError, TurnClaim } from './turn-claim.js';

// Sub-components (exported for advanced use cases)
export { PermissionEnforcer } from './permission-enforcer.js';
export { AUTO_COMPACT_THRESHOLD, ContextWindowTracker } from './context-window-tracker.js';
export {
  CompactionError,
  CompactionOrchestrator,
  DEFAULT_COMPACTION_PROMPT,
} from './compaction-orchestrator.js';

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
export { SESSION_LOG_EVENT, isSessionLogEvent } from './session-log-events.js';
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
// an `agent-interface-*` package publishes contracts, vocabulary and discriminators — not mechanisms
// (`scan-interface-runtime`), and a decoder is a mechanism.
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
