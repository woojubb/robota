// @robota-sdk/agent-interface-session
//
// The session, interaction, event, driver, turn and compaction contract families, moved out of
// `agent-interface-transport` by ARCH-106 (issue #2110).
//
// LAYER 1. Unlike the three wave-1 owners, this package COMPOSES rather than sits at the bottom: it
// names execution, command and analytics contracts and depends on those packages downward. Nothing
// at layer 0 names a type from here.

// ── Context-compaction contracts (INFRA-025 SSOT) ────────────
export type { TCompactTrigger, ICompactEvent } from './compact-contracts.js';
export type {
  IResumableSessionSummary,
  ISessionDirectory,
  ISessionListing,
  ISessionSwitchedEvent,
} from './session-summary-contracts.js';
export type { ISessionLoopState, TSessionLoopPhase } from './session-loop-contracts.js';
// ── Interactive-session contracts ────────────────────────────
export type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  ISessionAgentJobs,
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
  ISessionCapabilityMap,
  ISessionCommands,
  ISessionStatusRead,
  ISessionStatusSnapshot,
  ISessionRuntimeTools,
  ISessionConversationRead,
  ISessionDriverAttribution,
  ISessionEvents,
  ISessionExecutionState,
  ISessionExecutionWorkspace,
  ISessionGoal,
  ISessionIdentity,
  ISessionLifecycle,
  ISessionPromptResolution,
  ISessionTurnControl,
  ISessionTurnSubmission,
  ISessionWorkspaceLocation,
  TInteractiveEventName,
  TTurnSource,
  IExecutionResult,
  ITurnHandle,
  ITurnNotRunError,
  TTurnNotRunReason,
  IToolState,
  IDiffLine,
  IToolSummary,
  TPermissionResultValue,
  TInteractivePermissionHandler,
  IPermissionRequestEvent,
  IAskRequestEvent,
  IPromptResolvedEvent,
  IContextFileRefreshedEvent,
  IInteractiveSessionRecord,
  IBranchEvent,
  IActiveBranchPointer,
  IGoalState,
  IGoalEvent,
  IGoalProgressEntry,
  TGoalStatus,
  TGoalStopReason,
  IPlanStep,
  TPlanStepStatus,
  TPlanPhase,
  IPlanArtifact,
} from './session-contracts.js';
export type {
  IInteractiveSessionStore,
  ISessionListEntry,
  ISessionRecordDecodeIssue,
  TSessionLoadOutcome,
} from './session-store-contracts.js';
export { SESSION_CAPABILITY_MEMBER_KEYS } from './session-capability-contracts.js';
export type {
  ISessionCapabilityHost,
  TSessionCapabilityHost,
  TSessionCapabilityReadResult,
} from './session-capability-contracts.js';
// ── Prompt history (SCREEN-1993) ────────────────────────────
export type {
  IPromptHistoryBlock,
  IPromptHistoryEntry,
  IPromptHistoryReadOptions,
  IPromptHistorySource,
  IPromptHistoryWriter,
} from './prompt-history-contracts.js';
// ── Driver identity + driver-routed event contracts ─────────
// REMOTE-014 E5: co-drive driver-id constants (values, not types).
export { OWNER_DRIVER_ID, AGENT_DRIVER_ID } from './driver-contracts.js';
export type {
  TDriverId,
  ISubmitOptions,
  IPeerTurnContext,
  IUiIntentEvent,
  ISessionRenamedEvent,
} from './driver-contracts.js';
// ── Interaction-channel contracts ────────────────────────────
export type {
  IInteractionChannel,
  IAgentDriver,
  IToolCallObservation,
  ITerminalHandoff,
  InteractionEvent,
  ICommandInfo,
} from './interaction-contracts.js';
export {
  readAssistantReplies,
  readLastAssistantText,
  readToolCalls,
  readErrors,
} from './interaction-contracts.js';
export { isTurnNotRunError } from './turn-contracts.js';
// ── Session-event payload contracts ──────────────────────────
export type {
  ISkillActivationEvent,
  TSkillActivationSource,
  TSkillActivationInvocation,
  TSkillActivationMode,
  TSkillActivationStatus,
  IMemoryEvent,
  IMemoryReference,
  TMemoryType,
  IPromptFileReferenceRecord,
  TPromptFileReferenceReason,
  IContextReferenceItem,
  TContextReferenceLoadType,
  TContextReferenceStatus,
} from './event-contracts.js';
export type { IPlanApprovalEvent } from './session-event-map.js';
