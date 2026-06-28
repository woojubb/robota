// @robota-sdk/agent-interface-transport

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
  ICommandResult,
  TCommandResultDataValue,
  ICommandInteraction,
  ICommandChoicePromptOption,
  TCommandInteractionPrompt,
  ICommandListEntry,
  TCommandEffect,
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
  IPermissionRequest,
  TActionRequest,
  TActionResponse,
  IPickItem,
  ICommandInfo,
  TCommandInteractionHint,
} from './interaction-contracts.js';
// Shared pure accessors over an InteractionEvent stream (values, not types).
export {
  readAssistantReplies,
  readLastAssistantText,
  readToolCalls,
  readErrors,
} from './interaction-contracts.js';

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
  TPermissionResultValue,
  TInteractivePermissionHandler,
  IContextFileRefreshedEvent,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  IGoalState,
  IGoalEvent,
  IGoalProgressEntry,
  TGoalStatus,
  TGoalStopReason,
} from './session-contracts.js';
