/**
 * Interactive-session contracts — the minimal session surface, execution result,
 * event map, and persistence shapes consumed by transport adapters.
 *
 * SSOT for the session-facing contract types. The InteractiveSession runtime and the
 * session-store implementation live in agent-framework and import these declarations.
 */

import type { ICompactEvent } from './compact-contracts';
import type { ISessionRenamedEvent, IUiIntentEvent, TDriverId } from './driver-contracts.js';
import type {
  IContextReferenceItem,
  IMemoryEvent,
  IMemoryReference,
  IPlanApprovalEvent,
  ISkillActivationEvent,
} from './event-contracts.js';
import type {
  ISessionAgentJobs,
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
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
} from './session-capability-contracts.js';
import type { IExecutionResult, TTurnSource } from './turn-contracts.js';
import type {
  IActionRequest,
  IContextWindowState,
  IHistoryEntry,
  IToolSchema,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { IExecutionWorkspaceEvent } from '@robota-sdk/agent-interface-execution';
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
} from './session-capability-contracts.js';

/** Permission handler result — SDK-owned type (mirrors agent-sessions TPermissionResult).
 *  true = allow, false = deny, 'allow-session' = allow and remember for this session,
 *  'allow-project' = allow and persist to the project's local settings (location owned by the consuming layer). */
export type TPermissionResultValue = boolean | 'allow-session' | 'allow-project';

/** A single diff line for Edit tool display. */
export interface IDiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk';
  text: string;
  lineNumber: number;
}

/** Tool execution state visible to clients. */
export interface IToolState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
  result?: 'success' | 'error' | 'denied';
  diffLines?: IDiffLine[];
  diffFile?: string;
  toolResultData?: string;
  executionId?: string;
}

/** Summary of a tool call extracted from history. */
export interface IToolSummary {
  name: string;
  args: string;
}

// RUNTIME-003: a submission's identity, its ORIGIN (PEER-002) and the ways it can end live there.
export type {
  IExecutionResult,
  ITurnHandle,
  ITurnNotRunError,
  TTurnNotRunReason,
  TTurnSource,
} from './turn-contracts.js';

/** Permission handler delegate — clients provide their own UI. */
export type TInteractivePermissionHandler = (
  toolName: string,
  toolArgs: TToolArgs,
) => Promise<TPermissionResultValue>;

/**
 * REMOTE-007 (B4-2a) — transport-neutral permission/ask.
 *
 * The session emits a pending-prompt event and awaits a `resolve*(id)` reply instead of invoking a
 * single injected callback, so ANY attached surface (local TUI, a WS/WebRTC driver, a web UI) can
 * render + answer the SAME prompt. `id` correlates the emit with its resolve; the session parks the
 * awaiting promise and the first `resolvePermission`/`resolveAsk(id, …)` settles it (later resolves for
 * a settled id are no-ops). `prompt_resolved` lets a co-driving second surface dismiss a prompt the
 * first already answered.
 */

/** A tool call awaiting a permission decision. Serializable — crosses the transport boundary unchanged. */
export interface IPermissionRequestEvent {
  id: string;
  toolName: string;
  toolArgs: TToolArgs;
  /** REMOTE-014 E5: the driver whose turn raised this prompt (display-only). */
  requesterDriverId?: TDriverId;
}

/** An "ask the user" request (command- or tool-issued) awaiting an answer. Serializable. */
export interface IAskRequestEvent {
  id: string;
  request: IActionRequest;
  /** REMOTE-014 E5: the driver whose turn raised this prompt (display-only). */
  requesterDriverId?: TDriverId;
}

/** A pending prompt (permission or ask) that has been settled — attached surfaces dismiss it. */
export interface IPromptResolvedEvent {
  id: string;
  /** REMOTE-014 E5: the driver who answered the prompt (server-assigned; display-only). */
  answererDriverId?: TDriverId;
}

/** Emitted when a context file is found stale and re-read before a turn. */
export interface IContextFileRefreshedEvent {
  filePath: string; // Authority-scoped project-root-relative path, never an ambient host path.
}
// is at its size ratchet, so a new member splits rather than extends (PEER-002, #1809).
/** SELFHOST-007: a checkpoint/branch lifecycle transition a surface renders. */
type TCheckpointEventKind = `checkpoint_${'created' | 'restored' | 'rolled_back'}`;
type TBranchEventKind = `branch_${'forked' | 'switched'}`;
export interface IBranchEvent {
  kind: TCheckpointEventKind | TBranchEventKind;
  /** The checkpoint id the transition concerns. */
  checkpointId: string;
  /** The branch the checkpoint belongs to (or was switched/forked to). */
  branchId: string;
}

/**
 * SELFHOST-007: the persisted active-branch pointer — added to the resumable session record (beside
 * `goal`) so a branch survives `--resume`. Pure data. The branch TREE persists in the agent-framework
 * checkpoint manifest; a resume whose pointer references a `branchId`/`checkpointId` absent from that
 * manifest store must degrade gracefully (fall back to the linear HEAD), not crash.
 */
export interface IActiveBranchPointer {
  branchId: string;
  checkpointId: string;
}

/** Events emitted by InteractiveSession. */
export interface IInteractiveSessionEvents {
  text_delta: (delta: string) => void;
  tool_start: (state: IToolState) => void;
  tool_end: (state: IToolState) => void;
  thinking: (isThinking: boolean) => void;
  complete: (result: IExecutionResult) => void;
  error: (error: Error) => void;
  context_update: (state: IContextWindowState) => void;
  compact: (event: ICompactEvent) => void;
  interrupted: (result: IExecutionResult) => void;
  skill_activation: (event: ISkillActivationEvent) => void;
  background_task_event: (event: TBackgroundTaskEvent) => void;
  background_job_group_event: (event: TBackgroundJobGroupEvent) => void;
  execution_workspace_event: (event: IExecutionWorkspaceEvent) => void;
  user_message: (content: string) => void;
  /** Emitted at the start of each turn with its origin (human prompt vs agent-wakeup, FLOW-002). */
  turn_source: (source: TTurnSource) => void;
  /** Emitted when a context file (AGENTS.md or CLAUDE.md) is refreshed due to staleness. */
  context_file_refreshed: (event: IContextFileRefreshedEvent) => void;
  /** Emitted for every automatic-memory pipeline event (capture, approval, retrieval). */
  memory_event: (event: IMemoryEvent) => void;
  /** Emitted on every autonomous goal lifecycle transition (start, per-iteration, stop) — GOAL-001. */
  goal_event: (event: IGoalEvent) => void;
  /** Emitted on every plan-mode lifecycle transition (created, approved, reverted) — SELFHOST-002. */
  plan_event: (event: IPlanApprovalEvent) => void;
  /** Emitted after every persisted checkpoint/branch transition — SELFHOST-007. */
  branch_event: (event: IBranchEvent) => void;
  /** REMOTE-007: a tool call awaits a permission decision; answer via `resolvePermission(id, …)`. */
  permission_request: (event: IPermissionRequestEvent) => void;
  /** REMOTE-007: an "ask the user" request awaits an answer; answer via `resolveAsk(id, …)`. */
  ask_request: (event: IAskRequestEvent) => void;
  /** REMOTE-007: a pending prompt was settled (by any surface); attached surfaces dismiss it. */
  prompt_resolved: (event: IPromptResolvedEvent) => void;
  /** CMD-004 Phase 2: a command-issued UI intent — the requesting surface renders it (fire-and-forget). */
  ui_intent: (event: IUiIntentEvent) => void;
  /** CMD-004 Phase 2: the session was renamed host-side — all surfaces update their titles. */
  session_renamed: (event: ISessionRenamedEvent) => void;
  /** CMD-004 Phase 2: the conversation history was cleared host-side — all surfaces refresh transcripts. */
  history_cleared: () => void;
}

export type TInteractiveEventName = keyof IInteractiveSessionEvents;

/** Compatibility aggregate: declaration kind and all 39 required members remain source-compatible. */
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
    ISessionEvents,
    ISessionPromptResolution,
    ISessionBackgroundTasks,
    ISessionBackgroundGroups,
    ISessionExecutionWorkspace,
    ISessionAgentJobs {}

/**
 * Lifecycle status of an autonomous goal (GOAL-001).
 * `active` while the agent is pursuing it; terminal otherwise.
 */
export type TGoalStatus = 'active' | 'satisfied' | 'stopped';

/**
 * Why an autonomous goal stopped (GOAL-001). `satisfied` = the agent signalled completion;
 * `max-iterations` = the turn budget was exhausted; `cancelled` = the user stopped it;
 * `no-progress` = consecutive idle turns detected a stall (convergence guard).
 */
export type TGoalStopReason = 'satisfied' | 'max-iterations' | 'cancelled' | 'no-progress';

/** One recorded iteration of goal pursuit (GOAL-001). */
export interface IGoalProgressEntry {
  iteration: number;
  signal: 'continue' | 'satisfied';
  reason: string;
}

/**
 * Persisted state of an autonomous objective-pursuit loop (GOAL-001). Stored in the session
 * record so an in-flight goal survives `--resume`.
 */
export interface IGoalState {
  id: string;
  objective: string;
  status: TGoalStatus;
  stopReason?: TGoalStopReason;
  iterations: number;
  maxIterations: number;
  startedAt: string;
  progress: IGoalProgressEntry[];
}

/** Observability event for the goal loop (GOAL-001). */
export interface IGoalEvent {
  type: 'goal_started' | 'goal_progress' | 'goal_stopped';
  goal: IGoalState;
}

/** Execution status of one plan step (SELFHOST-002 plan-mode). */
export type TPlanStepStatus = 'pending' | 'in-progress' | 'done';

/** One reviewable step in a plan artifact (SELFHOST-002 plan-mode). */
export interface IPlanStep {
  /** Stable id within the plan. */
  id: string;
  /** Human-readable description of the step. */
  description: string;
  /** Step status as the plan is executed. */
  status: TPlanStepStatus;
}

/**
 * Lifecycle phase of a plan artifact (SELFHOST-002). `planning` = drafted in `plan` mode (read-only
 * tools); `awaiting-approval` = presented for review; `executing` = approved, edits unblocked per
 * `acceptEdits` (shell still per-call confirmed); `completed` = finished (mode reverts to `plan`).
 */
export type TPlanPhase = 'planning' | 'awaiting-approval' | 'executing' | 'completed';

/**
 * A reviewable plan/todo artifact produced during plan mode (SELFHOST-002). Persisted in the
 * session record beside {@link IGoalState} so an in-flight plan survives resume. Pure data — the
 * mutation block stays the existing `plan` permission mode (no artifact-carried enforcement).
 */
export interface IPlanArtifact {
  id: string;
  /** The objective the plan addresses. */
  objective: string;
  /** The ordered plan steps. */
  steps: IPlanStep[];
  /** Current lifecycle phase. */
  phase: TPlanPhase;
  createdAt: string;
  /** Set when the plan was approved (phase → `executing`). */
  approvedAt?: string;
}

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
