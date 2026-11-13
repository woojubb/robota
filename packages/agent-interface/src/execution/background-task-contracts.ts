/**
 * Background-task data contracts.
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

// `TBackgroundPermissionPolicy` is imported above for this file's own use and is not re-exported:
// its owner is `@robota-sdk/agent-core`, and consumers import it from there.

export type TBackgroundTaskKind = 'agent' | 'process' | 'scheduled' | 'tool-invocation';

export type TBackgroundTaskMode = 'foreground' | 'background';

export type TBackgroundTaskIsolation = 'none' | 'worktree';

export type TBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'sleeping'
  // A scheduled task whose recurrence is non-destructively paused (croner `.pause()`, not the
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
  /** Host-held origin; a worker must never substitute another credential for it. */
  apiKeyRef?: { readonly service: string; readonly account: string };
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
   * The persisted session record the child RESTORES before its first turn — a fork of the
   * parent conversation written under a fresh id by `/fork`. Only the id crosses: the conversation
   * itself never rides on the request, so the child-process wire stays as narrow as it is today
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
   * Monitor: a regular-expression source. Output lines matching it fire a
   * `background_task_waking` carrying `agentInstruction` + the matched line, so the agent
   * reacts to "something happened in this process's output".
   */
  matchPattern?: string;
  /** The instruction injected on a monitor match (paired with `matchPattern`). */
  agentInstruction?: string;
}

/**
 * A scheduled task carries NO `permissionPolicy`, by decision.
 *
 * A `kind: 'agent'` task spawns a SEPARATE agent, so it declares its own policy and the
 * permission enforcer applies it. A schedule with `agentInstruction` does not spawn anything: it WAKES the host
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
   * When set, each fire carries this instruction on the `background_task_waking`
   * event so an upper layer can wake the agent loop with a non-user turn.
   */
  agentInstruction?: string;
  shell?: string;
  env?: Record<string, string>;
  outputLimitBytes?: number;
}

/**
 * An in-flight MCP tool call handed off to the background-task manager. Data only —
 * the naming split is deliberate: the KIND is `'tool-invocation'` (the closed vocabulary
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
  /** Provenance: the only owner today. A closed union of one, matching the request's origin. */
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
 * Token usage a completed task/subagent consumed, for source attribution.
 * Alias of the `agent-core` usage-triple SSOT (`ITokenUsage`) — derived, not re-declared.
 */
export type IBackgroundTaskUsage = ITokenUsage;

/**
 * Why a tool call inside a task was refused — the same distinction the session-layer
 * enforcer already records for its own denials (`hasApprover ? 'user' : 'no-approver'`), named here for
 * a task's result rather than a live session's denial log: `'no-approver'` when no approver was
 * attached at all (print mode, a truly headless run); `'denied-by-person'` when one was attached and
 * answered no; `'approver-error'` when it threw or rejected instead of answering — a broken approver
 * still fails the call closed rather than hanging it; `'cancelled'` when the task ended (finished,
 * failed, or was stopped) before an attached approver's answer arrived — a `false` produced by that
 * cutoff is not the same fact as a person's own denial, so it is never counted as one.
 */
export type TBackgroundTaskPermissionDenialReason =
  'denied-by-person' | 'no-approver' | 'approver-error' | 'cancelled';

/**
 * How many of a task's tool calls were refused, and why. Additive: a caller only reads this when at
 * least one call was refused, so a task with none carries no new field — the result of a task that
 * finished exactly as it always did is unchanged.
 */
export interface IBackgroundTaskDeniedToolCalls {
  readonly total: number;
  readonly byReason: Readonly<Record<TBackgroundTaskPermissionDenialReason, number>>;
}

interface IBaseBackgroundTaskResult {
  taskId: string;
  output: string;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface IAgentBackgroundTaskResult extends IBaseBackgroundTaskResult {
  kind: 'agent';
  /** Total token usage of an agent task, attributed to it in the parent log. */
  usage?: IBackgroundTaskUsage;
  /** Present only when the task had at least one tool call refused. */
  deniedToolCalls?: IBackgroundTaskDeniedToolCalls;
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
 * The outcome hop discriminates by kind exactly as the request hop
 * (`TBackgroundTaskRequest`) does — `exitCode`/`signalCode` are producible only by the process
 * runner and `usage` only by the agent runner (`ISubagentJobResult` is
 * `Omit<IBackgroundTaskResult<'agent'>, 'kind'>`, not a hand-maintained `Omit` off the flat shape).
 * `IBackgroundTaskResult<K>` narrows to the kind-specific member for a caller that knows `K`
 * statically (a runner's `start()`, the decoder once it has
 * checked `kind`); called with no type argument it stays the full union. `IBackgroundTaskState<K>`
 * is discriminated the same way, and its `result` field is `IBackgroundTaskResult<K>` — correlated
 * with `state.kind`, not the free-standing full union.
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

/**
 * The persisted/live state hop discriminates by kind exactly as the request and result hops
 * do. Fields a single runner alone can produce — `agentType`/`isolation`/`resumeSessionId`/
 * `promptPreview`/the worktree-isolation fields (agent), `schedule`/`nextFireAt` (scheduled) — live
 * only on that kind's member. `commandPreview` is produced by every runner except the agent one (a
 * process command, a tool-invocation summary, or a schedule's shell command / wake instruction), so
 * it stays on the three non-agent members, not the base. `pid`/`logPath`/`transcriptPath` stay on
 * the shared base: the handle SPI (`IBackgroundTaskHandle`) already reports them generically for
 * whichever runner's process happens to produce them, and a subagent run as a child process (the
 * worktree-isolation runner) carries a `pid` exactly as a `process`-kind task does — an audit of
 * every producer (`background-task-manager-helpers.ts`, `subagent-manager.ts`,
 * `worktree-subagent-runner.ts`) found no case of an agent/process pid being kind-exclusive.
 * `timeoutReason` is likewise base: `interactive-session-restore.ts` sets `'stale_worker'` on ANY
 * non-terminal, non-rearmable task regardless of kind, not only on agent tasks.
 */
interface IBaseBackgroundTaskState<K extends TBackgroundTaskKind> {
  id: string;
  kind: K;
  label: string;
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
  currentAction?: string;
  unread: boolean;
  result?: IBackgroundTaskResult<K>;
  error?: IBackgroundTaskError;
  logPath?: string;
  transcriptPath?: string;
  /**
   * The transcript at `transcriptPath` is sealed: its bytes are ciphertext to any reader without the
   * keys, so the path reaches no content and a reader goes through the task's log read instead (the
   * `/agent read` command). Set from the runner's handle when the task starts; absent for a plain one.
   */
  transcriptSealed?: true;
  timeoutReason?: TBackgroundTaskTimeoutReason;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface IAgentBackgroundTaskState extends IBaseBackgroundTaskState<'agent'> {
  agentType?: string;
  promptPreview?: string;
  isolation?: TBackgroundTaskIsolation;
  /**
   * Carried from `IAgentBackgroundTaskRequest.resumeSessionId` so a surface can offer to
   * ATTACH to the forked session — a view switch onto that record, never a merge with the parent.
   */
  resumeSessionId?: string;
  worktreePath?: string;
  branchName?: string;
  worktreeStatus?: string;
  worktreeNextAction?: string;
  worktreeBaseRevision?: string;
  parentWorktreeStatus?: string;
}

export interface IProcessBackgroundTaskState extends IBaseBackgroundTaskState<'process'> {
  commandPreview?: string;
}

export interface IScheduledBackgroundTaskState extends IBaseBackgroundTaskState<'scheduled'> {
  commandPreview?: string;
  nextFireAt?: string;
  /**
   * For `kind: 'scheduled'` tasks, the reconstructable schedule definition.
   * Persisted with the task so a resumed session can re-arm the croner job.
   */
  schedule?: IBackgroundTaskSchedule;
}

export interface IToolInvocationBackgroundTaskState extends IBaseBackgroundTaskState<'tool-invocation'> {
  commandPreview?: string;
}

export type TBackgroundTaskState =
  | IAgentBackgroundTaskState
  | IProcessBackgroundTaskState
  | IScheduledBackgroundTaskState
  | IToolInvocationBackgroundTaskState;

export type IBackgroundTaskState<K extends TBackgroundTaskKind = TBackgroundTaskKind> = Extract<
  TBackgroundTaskState,
  { kind: K }
>;

/** The persisted, reconstructable definition of a scheduled wake. */
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
  /** Display lines; a record this process cannot show is a fixed placeholder line, never content. */
  lines: string[];
  /**
   * Records on this page that could not be shown as content, present only when there are any.
   * `locked`: sealed and the keys are locked, so an unlock shows them. `noKeys`: sealed and this
   * process holds no keys at all, so no unlock here shows them. `doesNotOpen`: damaged, sealed with
   * other keys, or sealed by a newer build.
   */
  unreadable?: IBackgroundTaskLogUnreadable;
}

/** How many records of a log page could not be shown as content, by why. */
export interface IBackgroundTaskLogUnreadable {
  locked: number;
  noKeys: number;
  doesNotOpen: number;
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
  // A scheduled/monitor task fired. `instruction`, when present, is the agent-wake
  // instruction an upper layer injects as a non-user turn.
  | { type: 'background_task_waking'; taskId: string; instruction?: string };

export type TBackgroundTaskEventListener = (event: TBackgroundTaskEvent) => void;
