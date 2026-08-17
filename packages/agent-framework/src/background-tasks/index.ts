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
//   - `IBackgroundTaskRunner` is reached through this barrel by FOUR packages — `agent-product`,
//     `agent-transport-tui`, `agent-transport` and `agent-cli`. None of the first three can even
//     resolve `@robota-sdk/agent-executor` under pnpm's strict layout; `agent-product`'s permitted
//     set is "agent-framework + agent-preset + agent-capability-pack + type-only
//     agent-interface-transport + agent-core types" (`.agents/project-structure.md`).
//
// Deleting the block turned `pnpm typecheck` red, which is how this was established rather than
// assumed. An earlier revision named two packages; a line-based search had missed the two whose
// import spans several lines.
//
// A LIMIT of the entry, stated because the criterion is per-symbol and the exemption is per-file:
// measured across the workspace, exactly ONE of these ten names — `IBackgroundTaskRunner` — has an
// external importer (6 files in 4 packages). The other NINE ride along on it. `agent-cli` also
// imports the runner straight from `agent-executor` (`modes/print-mode.ts`), so for that consumer
// the entry blesses a path it does not need. Narrowing the block to the one name it earns is the
// honest next step and belongs with the guard-widening item (ARCH-039) rather than here.
//
// INSIDE `agent-framework` the story is different and the redirect stands: this package does depend
// on `agent-executor`, so its own files import these from the SSOT directly.
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
