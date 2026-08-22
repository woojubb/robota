/**
 * Interactive-session contracts — the minimal session surface, execution result,
 * event map, and persistence shapes consumed by transport adapters.
 *
 * SSOT for the session-facing contract types. The InteractiveSession runtime and the
 * session-store implementation live in agent-framework and import these declarations.
 */

import type {
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from './background-group-contracts.js';
import type { IBackgroundTaskState, TBackgroundTaskEvent } from './background-task-contracts';
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
import type { IExecutionWorkspaceEvent } from './workspace-contracts.js';
import type {
  IActionRequest,
  IContextWindowState,
  IHistoryEntry,
  IToolSchema,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

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

// Re-export the background job-group contracts referenced by the session surface so
// that this module stays the single import hub for session-facing types.
export type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundJobGroupSummary,
  IBackgroundJobResultEnvelope,
  TBackgroundJobGroupEvent,
  TBackgroundJobGroupEventListener,
  TBackgroundJobGroupIdFactory,
  TBackgroundJobGroupStatus,
  TBackgroundJobWaitPolicy,
} from './background-group-contracts.js';

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

/**
 * ANALYTICS-001: the execution unit a usage snapshot is attributed to, so session-log usage can be
 * reported and asserted per source (main thread vs a specific subagent / background task). A minimal
 * contract-layer descriptor — the framework's `IExecutionOrigin` lives a layer up and cannot be
 * imported here; the two stay aligned by `scope`/`id`.
 */
export interface IUsageSource {
  scope: 'main' | 'subagent' | 'background' | 'tool' | 'command' | 'skill';
  /** Stable id of the source (e.g. the subagent / background-task id); omitted for the main thread. */
  id?: string;
  /** Human label for reports (e.g. the agent type or task title). */
  label?: string;
}

export interface IUsageSnapshot {
  kind: 'exact' | 'estimated';
  scope: 'turn';
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextUsedPercentage: number;
  costStatus: 'unknown' | 'estimated' | 'exact';
  /**
   * SELFHOST-004: derived turn cost in USD, present iff `costStatus !== 'unknown'` (i.e. the turn's
   * model was priced). Computed from the `agent-core/model-pricing.ts` SSOT (`calculateModelCost`,
   * exact input/output split). Optional = backward-compatible; a turn on an unpriced model omits it.
   */
  costUsd?: number;
  /** ANALYTICS-001: which execution unit consumed these tokens. Defaults to the main thread. */
  source?: IUsageSource;
}

/**
 * SELFHOST-004: a per-operation span entry recorded on the session timeline. Carried as the `data` of
 * an `IHistoryEntry<ISpanEntry>` on `IInteractiveSessionRecord.history`. It is the record-side projection
 * of the `agent-core` span-completion event (`ISpanCompletionEventData`): the framework builds it from
 * the event (mirroring the usage-summary entry), so `agent-core` never depends on this transport type.
 * Joinable to its turn via the enclosing entry's position in `history`.
 */
export interface ISpanEntry {
  /** The span id (equals the source event's `spanId`; correlatable across the trace). */
  spanId: string;
  /** The operation name (e.g. the tool name). */
  op: string;
  /** Measured wall-clock duration of the operation, in milliseconds. */
  durationMs: number;
}

/**
 * SELFHOST-004: the trace/cost read-model that crosses the sidecar boundary (P5 carrier). It is a
 * BOUNDARY CONTRACT, so it is owned here (both the `agent-session-analytics` producer and the
 * `agent-transport-protocol` carrier depend on `agent-interface-transport`). `summarizeUsageBySource`
 * assembles it; a `TServerMessage` variant carries it to the TUI/GUI.
 */
export interface IUsageSourceTotals {
  /** Stable grouping key (`<scope>:<id>`). */
  key: string;
  source: IUsageSource;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** How many usage snapshots (turns) were attributed to this source. */
  turns: number;
  /** Share of the session's total tokens, 0–100 (rounded to 1 decimal). */
  percentage: number;
  /** Exact cost (USD) summed from each turn's `IUsageSnapshot.costUsd` (unpriced turns contribute 0). */
  costUsd: number;
  /** Whether every turn attributed to this source carried an exact `costUsd`. */
  costExact: boolean;
}

/** SELFHOST-004: one per-operation span on the run timeline (record-side projection of a span event). */
export interface IRunTraceSpan {
  spanId: string;
  op: string;
  durationMs: number;
}

/** SELFHOST-004: one turn on the run timeline, with its sub-turn spans grouped underneath. */
export interface IRunTraceTurn {
  /** 0-based position of this turn among the session's usage-summary turns. */
  turnIndex: number;
  /** The source that owns this turn (main thread when unattributed). */
  source: IUsageSource;
  label: string;
  /** Spans that ran during this turn, in timeline order. */
  spans: IRunTraceSpan[];
  /** Sum of the turn's span durations, in milliseconds. */
  totalDurationMs: number;
}

export interface IUsageBySourceReport {
  sessionId: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Exact total cost (USD) across all priced turns in the session. */
  costUsd: number;
  /** Whether every turn in the session carried an exact `costUsd` (no unpriced turns). */
  costExact: boolean;
  /** Per-source totals, sorted by `totalTokens` descending. */
  bySource: IUsageSourceTotals[];
  /** The single biggest token consumer, if any usage was recorded. */
  topConsumer?: IUsageSourceTotals;
  /** The span timeline — one entry per turn, sub-turn spans grouped under their owning turn. */
  timeline: IRunTraceTurn[];
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
  filePath: string;
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

/** Persistence port for resumable interactive sessions. */
export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord): void;
  load(id: string): IInteractiveSessionRecord | undefined;
  list(): IInteractiveSessionRecord[];
  delete(id: string): void;
}
