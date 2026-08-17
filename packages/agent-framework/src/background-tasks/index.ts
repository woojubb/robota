export {
  BackgroundJobOrchestrator,
  summarizeBackgroundJobGroup,
} from './background-job-orchestrator.js';
export { createExecutionWorkspaceSnapshot } from './execution-workspace-projection.js';
export { createLineDetailPage, createMainThreadDetailPage } from './execution-workspace-detail.js';
export { createExecutionWorkspaceTaskSpawner } from './execution-workspace-spawner.js';
export {
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createExecutionOriginMetadata,
  createMainThreadExecutionEntryId,
  parseExecutionWorkspaceEntryId,
  EXECUTION_ORIGIN_METADATA_KEYS,
} from './execution-workspace-types.js';
// ARCH-037: these ten are `agent-executor`'s, re-published here for a STRUCTURAL reason, not as a
// runtime facade. Measured, after an attempt to delete them failed:
//
//   - `agent-product`'s permitted dependency set is "agent-framework + agent-preset +
//     agent-capability-pack + type-only agent-interface-transport + agent-core types"
//     (`.agents/project-structure.md`) — `agent-executor` is not in it;
//   - `agent-transport-tui` likewise does not depend on `agent-executor`.
//
// Both name `IBackgroundTaskRunner`, so this barrel is their only permitted path to it. Deleting the
// block turned `pnpm typecheck` red in both packages, which is how the reason was established rather
// than assumed. INSIDE `agent-framework` the story is different and the redirect stands: this
// package does depend on `agent-executor`, so its own files import these from the SSOT directly.
export type {
  IBackgroundTaskHandle,
  IBackgroundTaskManager,
  IBackgroundTaskManagerOptions,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  TBackgroundTaskIdFactory,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskTransitionEvent,
  ICreateLimitedOutputCaptureOptions,
  ILimitedOutputCapture,
} from '@robota-sdk/agent-executor';
export type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupSummary,
  IBackgroundJobGroupState,
  IBackgroundJobOrchestratorOptions,
  IBackgroundJobResultEnvelope,
  TBackgroundJobGroupEvent,
  TBackgroundJobGroupEventListener,
  TBackgroundJobGroupIdFactory,
  TBackgroundJobGroupStatus,
  TBackgroundJobWaitPolicy,
} from './background-job-orchestrator.js';
export type {
  ICreateExecutionWorkspaceSnapshotInput,
  ICreateLineDetailPageInput,
  ICreateMainThreadDetailPageInput,
  ICreateMainThreadEntryInput,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionDetailRecord,
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceEntryRef,
  IExecutionWorkspaceEvent,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  TExecutionAttention,
  TExecutionControl,
  TExecutionDetailRecordKind,
  TExecutionEntryKind,
  TExecutionOriginKind,
  TExecutionWorkspaceStatus,
  TExecutionWorkspaceUpdateCause,
  TExecutionWorkspaceVisibility,
} from './execution-workspace-types.js';
export type {
  IBackgroundTaskSpawnerGroupRequest,
  ICreateExecutionWorkspaceTaskSpawnerOptions,
  IExecutionWorkspaceTaskSpawner,
  ISpawnAgentTaskRequest,
  ISpawnProcessTaskRequest,
} from './execution-workspace-spawner.js';
