/**
 * Interactive-session contracts — the minimal session surface, execution result,
 * event map, and persistence shapes consumed by transport adapters.
 *
 * SSOT for the session-facing contract types. The InteractiveSession runtime and the
 * session-store implementation live in agent-framework and import these declarations.
 */

import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from './background-group-contracts.js';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
  TBackgroundTaskIsolation,
} from './background-task-contracts';
import type { ICommandListEntry, ICommandResult } from './command-contracts.js';
import type { ICompactEvent } from './compact-contracts';
import type {
  IContextReferenceItem,
  IMemoryEvent,
  IMemoryReference,
  IPromptFileReferenceRecord,
  ISkillActivationEvent,
} from './event-contracts.js';
import type { ISubagentJobState } from './subagent-contracts';
import type {
  IExecutionWorkspaceEvent,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
} from './workspace-contracts.js';
import type {
  IContextWindowState,
  IHistoryEntry,
  IToolSchema,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

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
 *  'allow-project' = allow and persist to .robota/settings.local.json. */
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
  /** ANALYTICS-001: which execution unit consumed these tokens. Defaults to the main thread. */
  source?: IUsageSource;
}

/** Summary of a tool call extracted from history. */
export interface IToolSummary {
  name: string;
  args: string;
}

/** Result of a completed prompt execution. */
export interface IExecutionResult {
  response: string;
  history: IHistoryEntry[];
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
  usage?: IUsageSnapshot;
  promptFileReferences?: IPromptFileReferenceRecord[];
}

/** Permission handler delegate — clients provide their own UI. */
export type TInteractivePermissionHandler = (
  toolName: string,
  toolArgs: TToolArgs,
) => Promise<TPermissionResultValue>;

/** Emitted when a context file is found stale and re-read before a turn. */
export interface IContextFileRefreshedEvent {
  filePath: string;
}

/** Origin of a turn — distinguishes a human prompt from an agent-wakeup re-entry (FLOW-002). */
export type TTurnSource = 'user' | 'agent-wakeup';

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
}

export type TInteractiveEventName = keyof IInteractiveSessionEvents;

/** Minimal session surface consumed by transport adapters and test factories. */
export interface IInteractiveSession {
  /** True once the underlying session has been initialized. */
  readonly isInitialized?: boolean;

  // Submission
  submit(input: string, displayInput?: string, rawInput?: string): Promise<void>;
  abort(): void;
  cancelQueue(): void;
  shutdown(options?: { reason?: string; message?: string }): Promise<void>;

  // Autonomous goal pursuit (GOAL-001)
  setGoal(
    objective: string,
    options?: { maxIterations?: number; noProgressLimit?: number },
  ): Promise<IGoalState>;
  getGoalState(): IGoalState | null;
  cancelGoal(): IGoalState | null;

  // State
  isExecuting(): boolean;
  getPendingPrompt(): string | null;
  getMessages(): TUniversalMessage[];
  getContextState(): IContextWindowState;
  getSession(): { getSessionId(): string };
  getCwd(): string;

  // Commands
  executeCommand(name: string, args: string): Promise<ICommandResult | null>;
  listCommands(): ICommandListEntry[];

  // Events
  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;

  // Background tasks
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  getBackgroundTask(taskId: string): IBackgroundTaskState | undefined;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
  sendBackgroundTask(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;

  // Background job groups
  listBackgroundJobGroups(): IBackgroundJobGroupState[];
  getBackgroundJobGroup(groupId: string): IBackgroundJobGroupState | undefined;
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;

  // Execution workspace
  getExecutionWorkspaceSnapshot(
    options?: IExecutionWorkspaceSnapshotOptions,
  ): IExecutionWorkspaceSnapshot;

  // Agent jobs
  listAgentDefinitions(): Array<{ name: string; description: string }>;
  listAgentJobs(): ISubagentJobState[];
  spawnAgentJob(input: {
    agentType: string;
    label: string;
    mode: 'foreground' | 'background';
    prompt: string;
    model?: string;
    isolation?: TBackgroundTaskIsolation;
  }): Promise<ISubagentJobState>;
  sendAgentJob(jobId: string, prompt: string): Promise<void>;
  cancelAgentJob(jobId: string, reason?: string): Promise<void>;
  closeAgentJob(jobId: string): Promise<void>;
}

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
}

/** Persistence port for resumable interactive sessions. */
export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord): void;
  load(id: string): IInteractiveSessionRecord | undefined;
  list(): IInteractiveSessionRecord[];
  delete(id: string): void;
}

/** Projection used to render a resume picker. */
export interface IResumableSessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}
