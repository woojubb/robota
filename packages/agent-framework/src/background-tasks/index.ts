export {
  BackgroundJobOrchestrator,
  summarizeBackgroundJobGroup,
} from './background-job-orchestrator.js';
export { createExecutionWorkspaceSnapshot } from './execution-workspace-projection.js';
// The `attach` control's decision, owned beside the projection that offers it.
export {
  attachKind,
  liveBackgroundJobCount,
  resolveExecutionAttach,
} from './execution-workspace-attach.js';
export type {
  IHostAttachFacts,
  IStoreAttachFacts,
  TExecutionAttachFacts,
  TExecutionAttachKind,
  TExecutionAttachOutcome,
} from './execution-workspace-attach.js';
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
// These ten are `agent-executor`'s, re-published here for a STRUCTURAL reason, not as a
// runtime facade. Measured, after an attempt to delete them failed:
//
//   - `IBackgroundTaskRunner` is reached through this barrel by FOUR packages — `agent-product`,
//     `agent-ui-terminal`, `agent-transport` and `agent-cli`. None of the first three can even
//     resolve `@robota-sdk/agent-executor` under pnpm's strict layout; `agent-product`'s permitted
//     set is "agent-framework + agent-preset + agent-capability-pack + type-only
//     agent-interface/transport + agent-core types" (`.agents/project-structure.md`).
//
// Deleting the block turned `pnpm typecheck` red, which is how this was established rather than
// assumed. An earlier revision named two packages; a line-based search had missed the two whose
// import spans several lines.
//
// The exemption is granted per SYMBOL, not per file, so the nine names that once rode along on
// `IBackgroundTaskRunner` are not re-published — measured, none of them had an external importer
// at all. `agent-cli` still imports the runner straight from
// `agent-executor` as well, so for that one consumer this path is redundant; the three that cannot
// (`agent-product`, `agent-transport`, `agent-ui-terminal`) are why it stays.
//
// INSIDE `agent-framework` the story is different and the redirect stands: this package does depend
// on `agent-executor`, so its own files import these from the SSOT directly.
// The block holds only the ONE name that earns the exemption. `IBackgroundTaskRunner` stays because
// `agent-product`, `agent-transport` and `agent-ui-terminal` name it and none of them may depend on
// `agent-executor`; the remaining names are imported from the SSOT by anyone who needs them.
export type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
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
  IExecutionHeadline,
  IExecutionPendingRequest,
  IExecutionSelfPacedLoopSummary,
  TExecutionHeadlineKind,
  TExecutionNormalizedState,
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
