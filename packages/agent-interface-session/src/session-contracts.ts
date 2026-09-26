/**
 * Interactive-session contracts — the minimal session surface, execution result,
 * event map, and persistence shapes consumed by transport adapters.
 *
 * SSOT for the session-facing contract types. The InteractiveSession runtime and the
 * session-store implementation live in agent-framework and import these declarations.
 */

import type { ISessionLoopState } from './session-loop-contracts.js';
import type {
  IMemoryEvent,
  IMemoryReference,
  IContextReferenceItem,
  ISkillActivationEvent,
} from './event-contracts.js';
import type {
  ISessionAgentJobs,
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
  ISessionCommands,
  ISessionStatusRead,
  ISessionRuntimeTools,
  ISessionConversationRead,
  ISessionDriverAttribution,
  ISessionEvents,
  ISessionExecutionDetail,
  ISessionExecutionState,
  ISessionExecutionWorkspace,
  ISessionGoal,
  ISessionIdentity,
  ISessionLifecycle,
  ISessionPromptResolution,
  ISessionSelfPacedLoopControl,
  ISessionTurnControl,
  ISessionTurnSubmission,
  ISessionWorkspaceLocation,
} from './session-capability-contracts.js';
import type {
  IActiveBranchPointer,
  IGoalState,
  IPlanArtifact,
} from './session-event-map.js';
import type {
  IHistoryEntry,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from '@robota-sdk/agent-interface-execution';

export type {
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
  ISessionExecutionDetail,
  ISessionExecutionState,
  ISessionExecutionWorkspace,
  ISessionGoal,
  ISessionIdentity,
  ISessionLifecycle,
  ISessionPromptResolution,
  ISessionSelfPacedLoopControl,
  ISessionTurnControl,
  ISessionTurnSubmission,
  ISessionWorkspaceLocation,
} from './session-capability-contracts.js';

export type { IToolSummary } from './tool-summary-types.js';

// RUNTIME-003: a submission's identity, its ORIGIN (PEER-002) and the ways it can end live there.
export type {
  IExecutionResult,
  ITurnHandle,
  ITurnNotRunError,
  TTurnNotRunReason,
  TTurnSource,
} from './turn-contracts.js';

// Split into `session-event-map.ts` (permission/ask/prompt vocabulary, goal state, plan artifact,
// and `IInteractiveSessionEvents` itself): several of these are consumed by
// `session-capability-contracts.ts`, which this file itself imports from, and declaring them here
// created an import cycle. Re-exported so every existing import of these names keeps working.
export type {
  TPermissionResultValue,
  IDiffLine,
  IToolState,
  TInteractivePermissionHandler,
  IPermissionRequestEvent,
  IAskRequestEvent,
  IPromptResolvedEvent,
  IContextFileRefreshedEvent,
  IBranchEvent,
  IActiveBranchPointer,
  IInteractiveSessionEvents,
  TInteractiveEventName,
  TGoalStatus,
  TGoalStopReason,
  IGoalProgressEntry,
  IGoalState,
  IGoalEvent,
  TPlanStepStatus,
  IPlanStep,
  TPlanPhase,
  IPlanArtifact,
} from './session-event-map.js';

/** Aggregate session interface composed from its named capability ports. */
export interface IInteractiveSession
  extends
    ISessionLifecycle,
    ISessionTurnSubmission,
    ISessionTurnControl,
    ISessionGoal,
    ISessionExecutionState,
    ISessionDriverAttribution,
    ISessionConversationRead,
    ISessionIdentity,
    ISessionWorkspaceLocation,
    ISessionCommands,
    ISessionStatusRead,
    ISessionRuntimeTools,
    ISessionEvents,
    ISessionPromptResolution,
    ISessionBackgroundTasks,
    ISessionBackgroundGroups,
    ISessionExecutionWorkspace,
    ISessionExecutionDetail,
    ISessionSelfPacedLoopControl,
    ISessionAgentJobs {}

/** Persisted record for a resumable interactive session. */
export interface IInteractiveSessionRecord {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: TUniversalMessage[];
  history?: IHistoryEntry[];
  systemPrompt?: string;
  toolSchemas?: IToolSchema[];
  backgroundTasks?: IBackgroundTaskState[];
  backgroundTaskEvents?: TBackgroundTaskEvent[];
  backgroundJobGroups?: IBackgroundJobGroupState[];
  backgroundJobGroupEvents?: TBackgroundJobGroupEvent[];
  sessionLoops?: ISessionLoopState[];
  skillActivationEvents?: ISkillActivationEvent[];
  memoryEvents?: IMemoryEvent[];
  usedMemoryReferences?: IMemoryReference[];
  contextReferences?: IContextReferenceItem[];
  sandboxSnapshotId?: string;
  /** In-flight autonomous goal, persisted so it survives resume (GOAL-001). */
  goal?: IGoalState;
  /** In-flight plan artifact, persisted so it survives resume (SELFHOST-002 plan-mode). */
  plan?: IPlanArtifact;
  /** Active checkpoint branch pointer, persisted so a branch survives resume (SELFHOST-007). */
  activeBranch?: IActiveBranchPointer;
}

// The persistence port and its load-outcome vocabulary live in `session-store-contracts.ts`
// (TRANS-007): they are one subject, and this file is at its size ratchet.
