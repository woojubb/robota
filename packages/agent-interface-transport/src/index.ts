// @robota-sdk/agent-interface-transport

// ── Interaction primitives re-exported for transports (REMOTE-007) ──
// The transport-neutral prompt events (IAskRequestEvent/IPermissionRequestEvent) reference these
// agent-core SSOT types; re-export them here so transport adapters keep a single import hub.
export type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';

// ── Transport adapter contracts ──────────────────────────────
export type { ITransportAdapter } from './transport-adapter.js';
export type {
  ITransportConfig,
  IConfigurableTransport,
  ITransportEntry,
  ITransportRegistryView,
} from './transport-config.js';

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

// ── Subagent job data contracts (INFRA-025 SSOT) ─────────────
export type {
  TSubagentJobStatus,
  TSubagentJobMode,
  ISubagentJobState,
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
  TInteractiveEventName,
  TTurnSource,
  IExecutionResult,
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
  IResumableSessionSummary,
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
