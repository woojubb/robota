export { createProcessOperationLock } from '@robota-sdk/agent-os/node-lock';
// @robota-sdk/agent-session/node — what only a Node host can provide: the file-system store, log
// sink and source, the spill store and prompt-history file, and the process hooks. The main entry is
// platform-neutral (ARCHITECTURE.md "Runtime platforms") and takes each of these by injection.

export { NodeSessionStore, SESSION_CLAIMS_DIRECTORY } from './session-store.js';
export type { INodeSessionStoreOptions } from './session-store.js';
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
export { NodeSessionLogSink } from './node-session-log-sink.js';
export { NodeExternalPayloadSource, NodeSessionLogSource } from './session-log-sources.js';
export type { INodeExternalPayloadSourceOptions } from './session-log-sources.js';
// Sealed append lines and log sidecars: the one module every append store writes and reads through,
// so a prompt-history file, a log sink and a log source cannot disagree about what a line means.
export { StoredLines, StoredPayloads, splitStoredLines } from './stored-append-lines.js';
export type { IStoredPayloadWrite, TAppendLineKind, TStoredLine } from './stored-append-lines.js';
// Sealing in place what a store kept in plaintext before its host sealed, each converter
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
export { createNodeWorkspacePathResolver } from './workspace-path-resolver.js';
export { registerProcessExitFlush } from './process-exit-flush.js';
