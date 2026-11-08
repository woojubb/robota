export { InteractiveSession } from './interactive-session.js';
export type { IInteractiveSession } from './i-interactive-session.js';
export {
  ambiguousSessionNameMessage,
  isSafeSessionId,
  isSessionLocked,
  listResumableSessionSummaries,
  listResumableSessions,
  listUnreadableSessions,
  listUnreadableSessionsForWorkspace,
  lockedSessionMessage,
  lockedSessionReason,
  lockedSessionsNotice,
  resolveLatestSessionId,
  resolveReusableEmptySessionId,
  resolveSessionIdByIdOrName,
  scanSessionStore,
} from './session-persistence.js';
export type { TSessionIdResolution } from './session-persistence.js';
export type { IHostToolResultSpillStore } from './session-store-types.js';
// The one way a session store is decorated, so no view drops a member of the port.
export { decorateSessionStore } from './session-store-view.js';
export type { TSessionStoreOverrides } from './session-store-view.js';
export type { TLockedSessionReason } from './locked-session-wording.js';
export { generateSessionName } from './session-naming.js';
export { isLoopStopVerb } from './session-loop-stop-verb.js';
// What restoring a session does with a stored scheduled task; a host asks it to know whether a
// stored session would start work on its own, by the same rule the re-arm applies.
export { restoredScheduleDisposition } from './schedule-rearm.js';
export type { TRestoredScheduleDisposition } from './schedule-rearm.js';
// The one restore a subagent runner in ANY process performs for a fork job — the id it
// received becomes the copied conversation here, so no runner re-derives the injection.
export { restoreSessionRecordIntoSession, resumeRefusal } from './interactive-session-restore.js';
export type { ISessionRecordRestoreResult } from './interactive-session-restore.js';
// Why a resume over a store that seals was refused, for every surface that resumes.
export {
  SessionAuthorshipRefusedError,
  OWNER_SANDBOX_REVIEW_UNAVAILABLE,
  UNVERIFIED_SESSION_QUESTION,
  isSessionAuthorshipRefusedError,
  unacceptableSessionMessage,
  unverifiedSessionNotice,
} from './session-authorship-gate.js';
export type { TSessionAuthorshipRefusal } from './session-authorship-gate.js';
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
  TSessionLoadOutcome,
} from './session-store-types.js';
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
export {
  createExternalEventGrantHistory,
  ExternalEventGrantHistory,
  ExternalEventIngress,
} from './external-event-ingress.js';
export type {
  IExternalEventTokenClaim,
  IExternalEventTokenClaimStore,
  IExternalEventSourceOptions,
  IExternalEventSource,
  TExternalEventTokenClaimResult,
  TExternalEventReceipt,
  TExternalEventSettlement,
} from './external-event-ingress.js';

// A rename can fail because the stored record is unreadable, and a caller has to be able
// to tell that from any other error — so the error type is part of the surface, not an internal.
export {
  SessionRenameUnavailableError,
  persistSessionRename,
} from './interactive-session-rename.js';
