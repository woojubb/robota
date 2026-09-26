export { InteractiveSession } from './interactive-session.js';
export type { IInteractiveSession } from './i-interactive-session.js';
export {
  createProjectSessionStore,
  createNodeHostSessionStore,
  createNodeToolResultSpillStore,
  createUserSessionStore,
  createUserPromptHistoryFile,
  isSafeSessionId,
  listResumableSessionSummaries,
  listUnreadableSessions,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  WorkspaceProjectSessionStore,
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
} from './session-persistence.js';
export type { IHostToolResultSpillStore } from './session-persistence.js';
export { generateSessionName } from './session-naming.js';
// CLI-1994: the one restore a subagent runner in ANY process performs for a fork job — the id it
// received becomes the copied conversation here, so no runner re-derives the injection.
export { restoreSessionRecordIntoSession } from './interactive-session-restore.js';
export type { ISessionRecordRestoreResult } from './interactive-session-restore.js';
export type { IGenerateSessionNameOptions } from './session-naming.js';
export type { ILivePromptTracePort } from './interactive-session-live-prompt-trace.js';
export type {
  TInteractiveSessionOptions,
  IInteractiveSessionShutdownOptions,
} from './interactive-session.js';
export type { ISkillActivationEvent } from '../commands/index.js';
export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
} from './session-persistence.js';
export type {
  IToolState,
  IDiffLine,
  IExecutionResult,
  IToolSummary,
  IUsageSnapshot,
  TPermissionResultValue,
  TInteractivePermissionHandler,
  TInteractiveEventName,
  IInteractiveSessionEvents,
  IContextFileRefreshedEvent,
} from './types.js';
export type {
  ITransportAdapter,
  IConfigurableTransport,
  ITransportConfig,
} from '@robota-sdk/agent-interface-transport';
export { PeerMessageIngress } from './peer-message-ingress.js';
export { ExternalEventIngress } from './external-event-ingress.js';
export type {
  IExternalEventSourceOptions,
  IExternalEventSource,
  TExternalEventReceipt,
  TExternalEventSettlement,
} from './external-event-ingress.js';

// TRANS-007: a rename can fail because the stored record is unreadable, and a caller has to be able
// to tell that from any other error — so the error type is part of the surface, not an internal.
export {
  SessionRenameUnavailableError,
  persistSessionRename,
} from './interactive-session-rename.js';
