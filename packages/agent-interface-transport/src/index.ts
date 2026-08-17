// @robota-sdk/agent-interface-transport

// ── Interaction primitives re-exported for transports (REMOTE-007) ──
// The transport-neutral prompt events (IAskRequestEvent/IPermissionRequestEvent) reference these
// agent-core SSOT types; re-export them here so transport adapters keep a single import hub.
export type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';

// ── Transport adapter contracts ──────────────────────────────
export type {
  ITransportAdapter,
  ITransportCompletionRecord,
  ITransportFailureRecord,
  ITransportLifecycle,
  ITransportLifecycleError,
  ITransportRollbackError,
  ITransportRunnerAdapter,
  ITransportServiceAdapter,
  ITransportStartupError,
  TNonZeroExitCode,
  TTransportAbandonmentReason,
  TTransportAdapter,
  TTransportCompletionOutcome,
  TTransportLifecycleKind,
  TTransportLifecycleErrorCode,
  TTransportRunOutcome,
} from './transport-adapter.js';
export { createTransportFailedOutcome, isTransportRunOutcome } from './transport-adapter.js';
export type {
  ITransportConfig,
  IConfigurableTransport,
  ITransportSettingsCapability,
  ITransportEntry,
  ITransportConfigurationError,
  ITransportLifecycleRegistryView,
  ITransportRegistryView,
  ITransportSettingsRegistryView,
  TConfigurableTransport,
  TTransportConfigurationErrorCode,
} from './transport-config.js';

// ── Payload-agnostic channel contracts (TRANS-001) ───────────
export type {
  IBinaryFrame,
  IChannelDescriptor,
  IChannelEventFrame,
  IPayloadChannel,
  IPayloadChannelHost,
  TChannelEventMap,
  TChannelFrame,
  TChannelReceiveResult,
} from './channel-contracts.js';

// ── Capability descriptor contracts ──────────────────────────
export type {
  ICapabilityDescriptor,
  TCapabilityKind,
  TCapabilitySafety,
} from './capability-contracts.js';

// ── Command-system contracts ─────────────────────────────────
export type {
  ICommand,
  ICommandSource,
  ISkillExecutionPort,
  ISkillResolutionResult,
  ICommandResult,
  TCommandResultDataValue,
  TCommandInvocationSource,
  ICommandListEntry,
  TCommandHostAction,
  TCommandUiIntent,
  ICommandPluginAdapter,
  ICommandInstalledPlugin,
  ICommandAvailablePlugin,
  ICommandMarketplaceSource,
  ICommandPluginReloadResult,
  TPluginInstallScope,
  IStatusLineCommandSettings,
  TStatusLineCommandSettingsPatch,
} from './command-contracts.js';

// ── Interaction-channel contracts ────────────────────────────
export type {
  IInteractionChannel,
  IAgentDriver,
  IToolCallObservation,
  ITerminalHandoff,
  InteractionEvent,
  ICommandInfo,
} from './interaction-contracts.js';
// Shared pure accessors over an InteractionEvent stream (values, not types).
export {
  readAssistantReplies,
  readLastAssistantText,
  readToolCalls,
  readErrors,
} from './interaction-contracts.js';
// RUNTIME-003: the one narrowing for a rejected `ITurnHandle.completed` (a value, not a type).
export { isTurnNotRunError } from './turn-contracts.js';
// HARNESS-103: `createSessionCapabilityHost` / `readSessionCapability` are NOT here. They are the
// runtime mechanism the interface-package rule forbids, they have no production consumer, and they
// now live under `testing/` per `contracts→agent-interface-*, doubles→owner /testing`.
export { SESSION_CAPABILITY_MEMBER_KEYS } from './session-capability-contracts.js';
export type {
  ISessionCapabilityHost,
  TSessionCapabilityHost,
  TSessionCapabilityReadResult,
} from './session-capability-contracts.js';
// ── Driver identity + driver-routed event contracts ─────────
// REMOTE-014 E5: co-drive driver-id constants (values, not types).
export { OWNER_DRIVER_ID, AGENT_DRIVER_ID } from './driver-contracts.js';
export type {
  TDriverId,
  ISubmitOptions,
  IUiIntentEvent,
  ISessionRenamedEvent,
} from './driver-contracts.js';

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
  IPlanApprovalEvent,
} from './event-contracts.js';

// ── Background-task data contracts (INFRA-025 SSOT) ─────────
export type {
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskIsolation,
  TBackgroundTaskStatus,
  TBackgroundPermissionPolicy,
  TBackgroundTaskTimeoutReason,
  TBackgroundTaskErrorCategory,
  TBackgroundPrimitive,
  IBackgroundTaskError,
  ISerializableProviderProfile,
  IBaseBackgroundTaskRequest,
  IAgentBackgroundTaskRequest,
  IProcessBackgroundTaskRequest,
  IScheduledBackgroundTaskRequest,
  TBackgroundTaskRequest,
  IBackgroundTaskUsage,
  IBackgroundTaskResult,
  IBackgroundTaskState,
  IBackgroundTaskSchedule,
  IBackgroundTaskInput,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskListFilter,
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
} from './background-task-contracts.js';

// ── Subagent job data contracts (INFRA-025 SSOT; ARCH-031 request/result) ────
export type {
  TSubagentJobStatus,
  TSubagentJobMode,
  ISubagentJobState,
  ISubagentJobResult,
  ISubagentSpawnRequest,
} from './subagent-contracts.js';

// ── Context-compaction contracts (INFRA-025 SSOT) ────────────
export type { TCompactTrigger, ICompactEvent } from './compact-contracts.js';

// ── Background job-group contracts ───────────────────────────
export type {
  IBackgroundJobGroupState,
  IBackgroundJobGroupSummary,
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobResultEnvelope,
  TBackgroundJobGroupEvent,
  TBackgroundJobGroupEventListener,
  TBackgroundJobGroupIdFactory,
  TBackgroundJobGroupStatus,
  TBackgroundJobWaitPolicy,
} from './background-group-contracts.js';

// ── Execution-workspace contracts ────────────────────────────
export type {
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceEntryRef,
  IExecutionWorkspaceEvent,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionDetailRecord,
  ICreateExecutionWorkspaceSnapshotInput,
  ICreateLineDetailPageInput,
  ICreateMainThreadDetailPageInput,
  ICreateMainThreadEntryInput,
  TExecutionAttention,
  TExecutionControl,
  TExecutionDetailRecordKind,
  TExecutionEntryKind,
  TExecutionOriginKind,
  TExecutionWorkspaceStatus,
  TExecutionWorkspaceUpdateCause,
  TExecutionWorkspaceVisibility,
} from './workspace-contracts.js';

// ── Interactive-session contracts ────────────────────────────
export type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  ISessionAgentJobs,
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
  ISessionCapabilityMap,
  ISessionCommands,
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
  IUsageSnapshot,
  IUsageSource,
  ISpanEntry,
  IUsageSourceTotals,
  IRunTraceSpan,
  IRunTraceTurn,
  IUsageBySourceReport,
  TPermissionResultValue,
  TInteractivePermissionHandler,
  IPermissionRequestEvent,
  IAskRequestEvent,
  IPromptResolvedEvent,
  IContextFileRefreshedEvent,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
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
export type { IResumableSessionSummary } from './session-summary-contracts.js';

// SEC-008: the SHAPE of an admission decision. The machinery that produces it lives in
// @robota-sdk/agent-transport-protocol — an interface package carries no runtime dependency edge.
export type { ITransportAdmission, ITransportAdmissionConfig } from './admission.js';

// PEER-001 (#1809): the transport-neutral peer-message contract. The two discriminators are this
// package's own vocabulary — a contract may publish those; the wire machinery may not live here.
export type {
  IPeerAdmission,
  IPeerMessage,
  IPeerMessageAck,
  IPeerMessageIngress,
  IPeerOrigin,
  ISessionPeerMessagingPort,
  TPeerDeliveryState,
  TPeerTrust,
} from './peer-message-contracts.js';
export { isSameEnvironmentPeer, isTerminalPeerDelivery } from './peer-message-contracts.js';
