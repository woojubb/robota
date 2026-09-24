/**
 * Background-task data contracts (INFRA-025).
 *
 * SSOT for the task/job data shapes shared by the execution runtime and every transport
 * surface. Pure data only — the runner/manager SPI (ports, handles, the BackgroundTaskError
 * class) stays in `agent-executor`, which imports these contracts.
 */

import type {
  ITokenUsage,
  TBackgroundPermissionPolicy,
  TModelEffort,
  TUniversalValue,
} from '@robota-sdk/agent-core';

// ARCH-037: the `TBackgroundPermissionPolicy` pass-through re-export is removed. Its stated reason
// was "so existing consumers keep importing it from `agent-interface-transport` unchanged". There was
// exactly one — `agent-executor` — and it already depends on `agent-core`, so the same change points
// it at the SSOT; `agent-framework` and `agent-session` were importing from `agent-core` already. An
// earlier revision of this comment said "there were none", which was wrong about the very consumer
// this change had to redirect. The type is still imported above for this file's own use.

export type TBackgroundTaskKind = 'agent' | 'process' | 'scheduled' | 'tool-invocation';

export type TBackgroundTaskMode = 'foreground' | 'background';

export type TBackgroundTaskIsolation = 'none' | 'worktree';

export type TBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'sleeping'
  // SELFHOST-012: a scheduled task whose recurrence is non-destructively paused (croner `.pause()`, not the
  // irreversible `.stop()` that `cancelled` uses). Non-terminal — resumes to `sleeping`.
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TBackgroundTaskTimeoutReason =
  'idle' | 'max_runtime' | 'output_limit' | 'repetition' | 'stale_worker';

export type TBackgroundTaskErrorCategory =
  | 'validation'
  | 'capacity'
  | 'permission'
  | 'timeout'
  | 'runner'
  | 'crash'
  | 'provider'
  | 'process';

export type TBackgroundPrimitive = string | number | boolean;

export interface IBackgroundTaskError {
  category: TBackgroundTaskErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ISerializableProviderProfile {
  profileName?: string;
  type: string;
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IBaseBackgroundTaskRequest {
  kind: TBackgroundTaskKind;
  label: string;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface IAgentBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'agent';
  agentType: string;
  prompt: string;
  model?: string;
  effort?: TModelEffort;
  isolation?: TBackgroundTaskIsolation;
  /**
   * CLI-1994: the persisted session record the child RESTORES before its first turn — a fork of the
   * parent conversation written under a fresh id by `/fork`. Only the id crosses: the conversation
   * itself never rides on the request, so the child-process wire stays as narrow as ARCH-044 left it
   * (the child reads the record from the session store, exactly as `--fork-session` does). Absent ⇒
   * the child starts with an empty conversation, unchanged.
   */
  resumeSessionId?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionPolicy: TBackgroundPermissionPolicy;
  providerProfile?: ISerializableProviderProfile;
  outputLimitBytes?: number;
  maxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}

export interface IProcessBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'process';
  command: string;
  shell?: string;
  env?: Record<string, string>;
  stdin?: string;
  outputLimitBytes?: number;
  /**
   * FLOW-004 (monitor): a regular-expression source. Output lines matching it fire a
   * `background_task_waking` carrying `agentInstruction` + the matched line, so the agent
   * reacts to "something happened in this process's output".
   */
  matchPattern?: string;
  /** FLOW-004: the instruction injected on a monitor match (paired with `matchPattern`). */
  agentInstruction?: string;
}

/**
 * A scheduled task carries NO `permissionPolicy`, by decision (issue #2354).
 *
 * A `kind: 'agent'` task spawns a SEPARATE agent, so it declares its own policy and CORE-025
 * enforces it. A schedule with `agentInstruction` does not spawn anything: it WAKES the host
 * session (`background_task_waking` → `requestWakeup` → an `agent-wakeup` turn), and that turn runs
 * under the host session's own permission configuration — mode, allow/deny rules, hooks, session
 * consent — exactly as a turn the user typed would. Inheritance is the contract, not an omission:
 * a policy field here would either duplicate the session's or silently disagree with it. The
 * `contracts.test.ts` type assertion fails if one is added without that wiring being designed.
 */
export interface IScheduledBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'scheduled';
  cronExpression: string;
  /**
   * Shell command to run on each fire. Optional when `agentInstruction` is set —
   * an agent-wake schedule may fire the agent loop instead of (or in addition to) a shell command.
   */
  command?: string;
  /**
   * FLOW-001: when set, each fire carries this instruction on the `background_task_waking`
   * event so an upper layer (FLOW-002) can wake the agent loop with a non-user turn.
   */
  agentInstruction?: string;
  shell?: string;
  env?: Record<string, string>;
  outputLimitBytes?: number;
}

/**
 * MCP-004 §S1: an in-flight MCP tool call handed off to the background-task manager. Data only —
 * the naming split is deliberate: the KIND is `'tool-invocation'` (INFRA-025's closed vocabulary
 * names the thing that runs), while the feature, its files and its tests keep the name "tool-call
 * handoff" (what a user does with it). Provenance is flattened into primitive fields rather than a
 * nested object so the request stays data-only and the executor helpers can project the same
 * fields into `metadata` for `/tasks` to read (agent-executor, not this package, owns that
 * projection). The remaining budget rides the base request's `maxRuntimeMs` — no dedicated field.
 */
export interface IToolInvocationBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'tool-invocation';
  toolName: string;
  /** Looked up by the runner's adoption registry (`agent-executor`) to find the already-running call. */
  adoptionToken: string;
  /** MCP-004 provenance: the only owner today. A closed union of one, matching the request's origin. */
  provenanceOwner: 'mcp';
  serverId: string;
  sourceName: string;
  securityIdentity?: string;
  /** Provenance metadata for `/tasks` and the notification — not an enforcement carrier (§ Decision). */
  permissionMode: string;
}

export type TBackgroundTaskRequest =
  | IAgentBackgroundTaskRequest
  | IProcessBackgroundTaskRequest
  | IScheduledBackgroundTaskRequest
  | IToolInvocationBackgroundTaskRequest;

/**
 * ANALYTICS-001 (Phase 2): token usage a completed task/subagent consumed, for source attribution.
 * TYPE-003: alias of the `agent-core` usage-triple SSOT (`ITokenUsage`) — derived, not re-declared.
 */
export type IBackgroundTaskUsage = ITokenUsage;

interface IBaseBackgroundTaskResult {
  taskId: string;
  output: string;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface IAgentBackgroundTaskResult extends IBaseBackgroundTaskResult {
  kind: 'agent';
  /** ANALYTICS-001 (Phase 2): total token usage of an agent task, attributed to it in the parent log. */
  usage?: IBackgroundTaskUsage;
}

export interface IProcessBackgroundTaskResult extends IBaseBackgroundTaskResult {
  kind: 'process';
  exitCode?: number;
  signalCode?: string;
}

export interface IScheduledBackgroundTaskResult extends IBaseBackgroundTaskResult {
  kind: 'scheduled';
}

export interface IToolInvocationBackgroundTaskResult extends IBaseBackgroundTaskResult {
  kind: 'tool-invocation';
}

/**
 * #2079: the outcome hop discriminates by kind exactly as the request hop
 * (`TBackgroundTaskRequest`) does — `exitCode`/`signalCode` are producible only by the process
 * runner and `usage` only by the agent runner (`ISubagentJobResult` is now
 * `Omit<IBackgroundTaskResult<'agent'>, 'kind'>`, not a hand-maintained `Omit` off the flat shape).
 * `IBackgroundTaskResult<K>` narrows to the kind-specific member for a caller that knows `K`
 * statically (a runner's `start()`, the decoder once it has
 * checked `kind`); called with no type argument it stays the full union, which is what
 * `IBackgroundTaskState.result` still holds — that field is not itself correlated with `state.kind`
 * (untouched by this change; revisit only if `IBackgroundTaskState` is ever discriminated).
 */
export type TBackgroundTaskResult =
  | IAgentBackgroundTaskResult
  | IProcessBackgroundTaskResult
  | IScheduledBackgroundTaskResult
  | IToolInvocationBackgroundTaskResult;

export type IBackgroundTaskResult<K extends TBackgroundTaskKind = TBackgroundTaskKind> = Extract<
  TBackgroundTaskResult,
  { kind: K }
>;

export interface IBackgroundTaskState {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  agentType?: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  pid?: number;
  startedAt?: string;
  updatedAt: string;
  lastActivityAt?: string;
  completedAt?: string;
  promptPreview?: string;
  commandPreview?: string;
  isolation?: TBackgroundTaskIsolation;
  /**
   * CLI-1994: carried from `IAgentBackgroundTaskRequest.resumeSessionId` so a surface can offer to
   * ATTACH to the forked session — a view switch onto that record, never a merge with the parent.
   */
  resumeSessionId?: string;
  currentAction?: string;
  unread: boolean;
  result?: IBackgroundTaskResult;
  error?: IBackgroundTaskError;
  logPath?: string;
  transcriptPath?: string;
  worktreePath?: string;
  branchName?: string;
  worktreeStatus?: string;
  worktreeNextAction?: string;
  worktreeBaseRevision?: string;
  parentWorktreeStatus?: string;
  timeoutReason?: TBackgroundTaskTimeoutReason;
  nextFireAt?: string;
  /**
   * FLOW-003: for `kind: 'scheduled'` tasks, the reconstructable schedule definition.
   * Persisted with the task so a resumed session can re-arm the croner job.
   */
  schedule?: IBackgroundTaskSchedule;
  metadata?: Record<string, TBackgroundPrimitive>;
}

/** FLOW-003: the persisted, reconstructable definition of a scheduled wake. */
export interface IBackgroundTaskSchedule {
  cronExpression: string;
  agentInstruction?: string;
  command?: string;
  shell?: string;
  env?: Record<string, string>;
}

export interface IBackgroundTaskInput {
  prompt?: string;
  stdin?: string;
}

export interface IBackgroundTaskLogCursor {
  offset: number;
}

export interface IBackgroundTaskLogPage {
  taskId: string;
  cursor?: IBackgroundTaskLogCursor;
  nextCursor?: IBackgroundTaskLogCursor;
  lines: string[];
}

export interface IBackgroundTaskListFilter {
  kind?: TBackgroundTaskKind;
  status?: TBackgroundTaskStatus;
  mode?: TBackgroundTaskMode;
  includeClosed?: boolean;
}

export type TBackgroundTaskEvent =
  | { type: 'background_task_created'; task: IBackgroundTaskState }
  | { type: 'background_task_started'; task: IBackgroundTaskState }
  | { type: 'background_task_updated'; task: IBackgroundTaskState }
  | { type: 'background_task_text_delta'; taskId: string; delta: string }
  | { type: 'background_task_tool_start'; taskId: string; toolName: string; firstArg?: string }
  | {
      type: 'background_task_tool_end';
      taskId: string;
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'background_task_permission_request';
      taskId: string;
      requestId: string;
      toolName: string;
      toolArgs: Record<string, TBackgroundPrimitive>;
    }
  | { type: 'background_task_completed'; task: IBackgroundTaskState }
  | { type: 'background_task_failed'; task: IBackgroundTaskState }
  | { type: 'background_task_cancelled'; task: IBackgroundTaskState }
  | { type: 'background_task_closed'; taskId: string }
  // FLOW-001: a scheduled/monitor task fired. `instruction`, when present, is the agent-wake
  // instruction an upper layer (FLOW-002) injects as a non-user turn.
  | { type: 'background_task_waking'; taskId: string; instruction?: string };

export type TBackgroundTaskEventListener = (event: TBackgroundTaskEvent) => void;
