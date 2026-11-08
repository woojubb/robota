// @robota-sdk/agent-interface/execution
//
// The execution-bounded contract families, owned here rather than by `agent-interface/transport`.
//
// LAYER 0: this subpath depends on `@robota-sdk/agent-core` and on no other subpath of
// `agent-interface`. Consumers compose it downward — `agent-interface/session` names these types, never the
// reverse.

// ── Background-task data contracts ─────────
export type {
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskIsolation,
  TBackgroundTaskStatus,
  TBackgroundTaskTimeoutReason,
  TBackgroundTaskErrorCategory,
  TBackgroundPrimitive,
  IBackgroundTaskError,
  ISerializableProviderProfile,
  IBaseBackgroundTaskRequest,
  IAgentBackgroundTaskRequest,
  IProcessBackgroundTaskRequest,
  IScheduledBackgroundTaskRequest,
  IToolInvocationBackgroundTaskRequest,
  TBackgroundTaskRequest,
  IBackgroundTaskUsage,
  TBackgroundTaskPermissionDenialReason,
  IBackgroundTaskDeniedToolCalls,
  IBackgroundTaskResult,
  IAgentBackgroundTaskResult,
  IProcessBackgroundTaskResult,
  IScheduledBackgroundTaskResult,
  IToolInvocationBackgroundTaskResult,
  TBackgroundTaskResult,
  IBackgroundTaskState,
  IAgentBackgroundTaskState,
  IProcessBackgroundTaskState,
  IScheduledBackgroundTaskState,
  IToolInvocationBackgroundTaskState,
  TBackgroundTaskState,
  IBackgroundTaskSchedule,
  IBackgroundTaskInput,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskLogUnreadable,
  IBackgroundTaskListFilter,
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
} from './background-task-contracts.js';
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
// ── Subagent job data contracts (request/result) ────
export type {
  TSubagentJobStatus,
  TSubagentJobMode,
  ISubagentJobState,
  ISubagentJobResult,
  ISubagentSpawnRequest,
} from './subagent-contracts.js';
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
  IExecutionHeadline,
  IExecutionPendingRequest,
  IExecutionSelfPacedLoopSummary,
  TExecutionAttention,
  TExecutionControl,
  TExecutionDetailRecordKind,
  TExecutionEntryKind,
  TExecutionHeadlineKind,
  TExecutionNormalizedState,
  TExecutionOriginKind,
  TExecutionWorkspaceStatus,
  TExecutionWorkspaceUpdateCause,
  TExecutionWorkspaceVisibility,
} from './workspace-contracts.js';
