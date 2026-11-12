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
// `IBackgroundTaskRunner` is `agent-executor`'s, re-published here for a STRUCTURAL reason, not as a
// runtime facade: `agent-product` and `agent-ui-terminal` name it and neither depends on
// `agent-executor`. The exemption is granted per SYMBOL, so every other `agent-executor` name is
// imported from its owner, and inside `agent-framework` its own files import this one from there too.
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
