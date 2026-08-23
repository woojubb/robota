// @robota-sdk/agent-interface-execution
//
// The execution-bounded contract families, moved out of `agent-interface-transport` by ARCH-103
// (issue #2109) under the owner map in `.agents/specs/contract-family-owner-map.md`.
//
// LAYER 0: this package depends on `@robota-sdk/agent-core` and on no peer `agent-interface-*`
// package. Consumers compose it downward — `agent-interface-session` names these types, never the
// reverse. See ARCH-101 for the rule and `scripts/harness/interface-layers.mjs` for the guard.

// ── Background-task data contracts (INFRA-025 SSOT) ─────────
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
// ── Subagent job data contracts (INFRA-025 SSOT; ARCH-031 request/result) ────
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
  TExecutionAttention,
  TExecutionControl,
  TExecutionDetailRecordKind,
  TExecutionEntryKind,
  TExecutionOriginKind,
  TExecutionWorkspaceStatus,
  TExecutionWorkspaceUpdateCause,
  TExecutionWorkspaceVisibility,
} from './workspace-contracts.js';
