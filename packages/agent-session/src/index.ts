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

// Sub-components (exported for advanced use cases)
export { PermissionEnforcer } from './permission-enforcer.js';
export { AUTO_COMPACT_THRESHOLD, ContextWindowTracker } from './context-window-tracker.js';
export {
  CompactionError,
  CompactionOrchestrator,
  DEFAULT_COMPACTION_PROMPT,
} from './compaction-orchestrator.js';

// SELFHOST-014: shareable/resumable session artifact envelope + the opt-in sensitive-key scrub (SSOT).
export {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  serializeSessionArtifact,
  deserializeSessionArtifact,
} from './session-artifact.js';
export type { ISessionArtifact, ISerializeSessionArtifactOptions } from './session-artifact.js';
export { SENSITIVE_KEY_PATTERN, isSensitiveKey, scrubSensitiveKeys } from './scrub-sensitive.js';
export type { TScrubbableValue } from './scrub-sensitive.js';

// Session logging
export { FileSessionLogger, SilentSessionLogger } from './session-logger.js';
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
export {
  loadSessionLogEntries,
  replaySessionLogEntries,
  validateSessionReplayLogEntries,
} from './session-log-replay.js';
export type {
  ISessionLogEntry,
  ISessionReplayRecord,
  ISessionReplayValidationIssue,
  ISessionReplayValidationResult,
} from './session-log-replay.js';

// Session persistence
export { SessionStore } from './session-store.js';
export type { ISessionRecord, ISessionStore } from './session-store.js';

// SELFHOST-007: neutral checkpoint tree (branching time-travel) — pure, I/O-free.
export { CheckpointTree } from './checkpoint-tree.js';
export type { ICheckpointNode } from './checkpoint-tree.js';
