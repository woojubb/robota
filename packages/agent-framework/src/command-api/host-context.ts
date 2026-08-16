import type { ICommandResult } from './command-result.js';
import type { ICommandHostAdapters } from './host-adapters.js';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
} from '../background-tasks/index.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/index.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';
import type { IGoalStartOptions } from '../goal/index.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IMemoryStore } from '../memory/types.js';
import type { TAutoCompactThreshold } from './context/context-command-api.js';
import type {
  IContextWindowState,
  IHistoryEntry,
  IUserInteraction,
  TModelEffort,
  TPermissionMode,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { IScheduleEditPatch } from '@robota-sdk/agent-executor';
import type {
  ICommandListEntry,
  IGoalState,
  IPlanArtifact,
  TCommandInvocationSource,
} from '@robota-sdk/agent-interface-transport';
import type {
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  ISubagentJobState,
  TBackgroundTaskIsolation,
} from '@robota-sdk/agent-interface-transport';
import type { ISessionReplayValidationResult } from '@robota-sdk/agent-session';
// ICommandListEntry SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
// TCommandInvocationSource SSOT relocated to @robota-sdk/agent-interface-transport (REMOTE-003).

export type { ICommandListEntry, TCommandInvocationSource };

export interface ICommandSkillListEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly argumentHint?: string;
  readonly context?: string;
  readonly agent?: string;
}

export interface ICommandSkillActivationRequest {
  readonly invocationSource: TCommandInvocationSource;
  readonly displayInput?: string;
  readonly rawInput?: string;
}

export type TAutoCompactThresholdSource = 'default' | 'settings' | 'session';

/**
 * Live model re-application options (PRESET-013). Carries the model group a preset switch may
 * re-apply to a running session; `maxOutputTokens` maps to the agent's `maxTokens` channel.
 */
export interface IModelReapplyOptions {
  model?: string;
  effort?: TModelEffort;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * A preset `enabledCommandModules`/`disabledCommandModules` name that matched no built command
 * module (INFRA-032). Surfaced as a non-fatal notice on both the startup `--preset` path and the
 * in-session `/preset` path instead of being silently dropped. `kind` records which list the
 * unmatched name came from.
 */
export interface IUnknownCommandModuleName {
  readonly name: string;
  readonly kind: 'enabled' | 'disabled';
}

/**
 * ARCH-029 — the command axis decomposed into role ports.
 *
 * Each interface below is a CAPABILITY, and the three exported names commands used to reference are
 * now empty `extends` aggregates over them. That is exactly the shape ARCH-012 landed one layer over
 * (`IInteractiveSession` at `agent-interface-transport/src/session-contracts.ts`), and it is what
 * lets a command declare only the role it uses: a role port is a SUPERTYPE of the aggregate, so a
 * command narrowing its declared parameter still satisfies `ISystemCommand.execute` by
 * contravariance — sound, not method bivariance.
 *
 * The aggregates stay because the dispatch contract needs one widest type. What must not stay is
 * consumers naming them: `scan-aggregate-naming.mjs` freezes that count and drives it to zero,
 * because the previous attempt on this contract (REFACTOR-006) closed green while the facade
 * survived, and it then grew from 20 members / 50% optional to 46 / 70%.
 */

/**
 * The role a command declares when it reads NOTHING from the host.
 *
 * Deliberately empty, and deliberately named. A command that needs no capability must still accept
 * the dispatch parameter positionally when a later parameter is used, and naming the 46-member
 * aggregate in order to ignore it is precisely the defect this decomposition removes — it takes the
 * whole surface for nothing. Every role port is a supertype of the aggregate; this is the widest
 * such supertype, so any host satisfies it.
 *
 * `unknown` would also type-check here and is NOT used: `code-quality.md` allows it only at trust
 * and `catch` boundaries, and an unused command parameter is neither.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the emptiness IS the contract: this role demands nothing.
export interface ICommandHostNoCapability {}

/** Reading and clearing the conversation the session holds. */
export interface ICommandSessionHistory {
  clearHistory(): void;
  getMessageCount(): number;
  getFullHistory(): IHistoryEntry[];
  getHistory(): TUniversalMessage[];
}

/** The session's context window and its compaction policy. */
export interface ICommandSessionContextWindow {
  compact(instructions?: string): Promise<void>;
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): number | false;
  setAutoCompactThreshold?(threshold: TAutoCompactThreshold): void;
}

/** What the session is currently permitted to do. */
export interface ICommandSessionPermissions {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionAllowedTools(): readonly string[];
}

/** Who this session is, and what it has spent. */
export interface ICommandSessionIdentity {
  getSessionId(): string;
  getSessionTokenUsage?(): { inputTokens: number; outputTokens: number } | undefined;
  getModelId?(): string | undefined;
}

/** Live model reconfiguration. */
export interface ICommandSessionModel {
  /**
   * Re-apply model/effort/temperature/maxOutputTokens to the live session (PRESET-013).
   * May be async: the runtime ensures the agent is fully initialized before mutating its model
   * configuration, so callers must await the result.
   */
  applyModelOptions?(options: IModelReapplyOptions): void | Promise<void>;
}

/** Live preset state carried by the session. */
export interface ICommandSessionPreset {
  /** Read the active preset id (PRESET-011 runtime state). */
  getActivePresetId?(): string;
  /** Set the active preset id (PRESET-011 runtime state — pure state, no option re-application). */
  setActivePresetId?(id: string): void;
  /** Toggle subagent dispatch live for the running session (PRESET-016 runtime gate). */
  setParallelSubagentsEnabled?(enabled: boolean): void;
}

/** Aggregate: all 18 members remain source-compatible. Declare a role port instead of this. */
export interface ICommandSessionRuntime
  extends
    ICommandSessionHistory,
    ICommandSessionContextWindow,
    ICommandSessionPermissions,
    ICommandSessionIdentity,
    ICommandSessionModel,
    ICommandSessionPreset {}

export interface ICommandSessionReplayValidationReport {
  logFile: string;
  entryCount: number;
  validation: ISessionReplayValidationResult;
}

/** Reaching the live session, and the whole-conversation operations that sit beside it. */
export interface ICommandHostSessionAccess {
  getSession(): ICommandSessionRuntime;
  clearConversationHistory?(): void;
  validateCurrentSessionReplayLog?(): ICommandSessionReplayValidationReport;
}

/** Reaching the agent-job capability, when the host has one. */
export interface ICommandHostAgentJobs {
  getAgentJobCapability?(): IAgentJobHostContext | undefined;
}

/** Asking the user a question. */
export interface ICommandHostUserInteraction {
  /**
   * CMD-004: the injected "ask the user" port, or undefined when no interactive renderer is attached.
   * A command solicits a structured answer via `getUserInteraction()?.ask(request)`; absence means no
   * human is available (headless/automation, or a model-invoked command) — the command must handle it
   * as a cancellation, never a silent guess.
   */
  getUserInteraction?(): IUserInteraction | undefined;
}

/** Re-applying preset-owned configuration to the live session. */
export interface ICommandHostPresetApplication {
  /** PRESET-014 — re-apply a preset persona to the live system prompt. */
  applyPersona?(persona: string): void;
  /** PRESET-017 — toggle the verify-before-done self-verification section on the live prompt. */
  applySelfVerification?(enabled: boolean): void;
  /**
   * PRESET-015 — re-apply command-module selection to the live session. Returns any
   * `enabled`/`disabled` names that matched no live command module (INFRA-032) so the `/preset`
   * command can surface them as a non-fatal notice; an empty array means every name matched.
   */
  applyCommandModuleSelection?(
    enabled: readonly string[] | undefined,
    disabled: readonly string[] | undefined,
  ): readonly IUnknownCommandModuleName[];
}

/** The host's view of the context window and its compaction. */
export interface ICommandHostContextWindow {
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): TAutoCompactThreshold;
  getAutoCompactThresholdSource?(): TAutoCompactThresholdSource;
  setAutoCompactThreshold?(
    threshold: TAutoCompactThreshold,
    source?: TAutoCompactThresholdSource,
  ): void;
  compactContext(instructions?: string): Promise<void>;
}

/** The files pinned into context by reference. */
export interface ICommandHostContextReferences {
  listContextReferences?(): IContextReferenceItem[];
  addContextReference?(path: string): Promise<IContextReferenceAddResult>;
  removeContextReference?(path: string): IContextReferenceRemoveResult;
  clearContextReferences?(): IContextReferenceClearResult;
}

/** Where the command is running, and how it was invoked. */
export interface ICommandHostWorkspace {
  getCwd(): string;
  getCommandInvocationSource?(): TCommandInvocationSource;
}

/** What commands and skills this host can dispatch. */
export interface ICommandHostCatalog {
  listCommands?(): ICommandListEntry[];
  listSkills?(): ICommandSkillListEntry[];
  executeSkillCommandByName?(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null>;
}

/** The edit-checkpoint tree: inspection, restore, and branching. */
export interface ICommandHostCheckpoints {
  listEditCheckpoints(): IEditCheckpointSummary[];
  inspectEditCheckpoint?(checkpointId: string): IEditCheckpointInspection;
  restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** SELFHOST-007: list the checkpoint branch tips (leaf ids) via the neutral tree. Optional (older hosts). */
  listCheckpointBranches?(): string[];
  /** SELFHOST-007: fork a new branch from a past checkpoint (non-destructive restore). Optional. */
  forkCheckpointBranch?(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** SELFHOST-007: switch the active branch to an existing checkpoint/branch tip. Optional. */
  switchCheckpointBranch?(checkpointId: string): void;
}

/** Durable memory: what was used, what happened, and the store behind it. */
export interface ICommandHostMemory {
  getUsedMemoryReferences(): IMemoryReference[];
  recordMemoryEvent(event: IMemoryEvent): void;
  /**
   * SELFHOST-008 P1R — the injected durable-memory port the `/memory` command reads/writes through, so a
   * surface that swaps the store is authoritative for command operations too (no split-brain). Optional:
   * when absent, the command path defaults to the neutral fs reference store over `getCwd()` (memory
   * behavior unchanged). Must return the SAME instance the session injected (SSOT for a stateful store).
   */
  getMemoryStore?(): IMemoryStore;
}

/** Observing and ending background tasks. */
export interface ICommandHostBackgroundTasks {
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
}

/** The autonomous-goal lifecycle. */
export interface ICommandHostGoal {
  /** GOAL-001 — assign and begin pursuing an autonomous goal. */
  setGoal?(objective: string, options?: IGoalStartOptions): Promise<IGoalState>;
  /** GOAL-001 — the current goal state, or null when no goal has been set. */
  getGoalState?(): IGoalState | null;
  /** GOAL-001 — cancel an in-flight goal; returns the stopped state or null. */
  cancelGoal?(): IGoalState | null;
}

/** The plan lifecycle, including the mode flip approval performs. */
export interface ICommandHostPlan {
  /** SELFHOST-002 — start a plan (draft for review; keeps `plan` mode). */
  setPlan?(objective: string, steps?: readonly string[]): Promise<IPlanArtifact>;
  /** SELFHOST-002 — the current plan artifact, or null when none started. */
  getPlanState?(): IPlanArtifact | null;
  /** SELFHOST-002 — approve the plan; applies the `plan → acceptEdits` mode flip. */
  approvePlan?(): IPlanArtifact;
  /** SELFHOST-002 — revert the plan to drafting; returns mode to `plan`. */
  revertPlan?(): IPlanArtifact;
}

/** Handing the real terminal to a child process. */
export interface ICommandHostTerminalHandoff {
  /**
   * TERM-001 — whether the active transport can hand the real terminal to a child process. `false`
   * (or `runWithTerminal` absent) when there is no interactive TTY (e.g. headless).
   */
  canHandoffTerminal?(): boolean;
  /**
   * TERM-001 — suspend the display, run `fn` (which spawns a child with inherited stdio), then
   * restore the display. Exclusive (one handoff at a time) and abort-safe; rejects without running
   * `fn` when a handoff is not possible. The framework owns this orchestration; the transport
   * implements the underlying suspend/resume.
   */
  runWithTerminal?<T>(fn: () => Promise<T>): Promise<T>;
}

/** The injected adapter bag — genuinely variational, and the named zero-optional carve-out. */
export interface ICommandHostAdapterAccess {
  getCommandHostAdapters?(): ICommandHostAdapters;
}

/** Aggregate: all 46 members remain source-compatible. Declare a role port instead of this. */
export interface ICommandHostContext
  extends
    ICommandHostSessionAccess,
    ICommandHostAgentJobs,
    ICommandHostUserInteraction,
    ICommandHostPresetApplication,
    ICommandHostContextWindow,
    ICommandHostContextReferences,
    ICommandHostWorkspace,
    ICommandHostCatalog,
    ICommandHostCheckpoints,
    ICommandHostMemory,
    ICommandHostBackgroundTasks,
    ICommandHostGoal,
    ICommandHostPlan,
    ICommandHostTerminalHandoff,
    ICommandHostAdapterAccess {}

/** Starting, steering and ending subagent jobs. */
export interface IAgentJobDispatch {
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
  sendAgentJob(taskId: string, prompt: string): Promise<void>;
  cancelAgentJob(taskId: string, reason?: string): Promise<void>;
  closeAgentJob(taskId: string): Promise<void>;
}

/** Fanning jobs out as a group and waiting on it. */
export interface IAgentJobGroups {
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;
}

/** Cron-driven wakes and their lifecycle. */
export interface IAgentJobSchedules {
  /**
   * FLOW-005: schedule a recurring/one-shot agent wake. On each cron fire the agent loop
   * re-enters with `agentInstruction` (FLOW-001/002). `cronExpression` may be a standard cron
   * string or an ISO timestamp (one-shot).
   */
  spawnScheduledWake(input: {
    label: string;
    cronExpression: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState>;
  /** SELFHOST-012: list the caller's scheduled tasks (each carries cadence, `nextFireAt`, and status). */
  listSchedules(): IBackgroundTaskState[];
  /** SELFHOST-012: non-destructively pause a scheduled task — it stops firing until `resumeSchedule`. */
  pauseSchedule(taskId: string): Promise<void>;
  /** SELFHOST-012: resume a paused scheduled task, re-armed with the same identity. */
  resumeSchedule(taskId: string): Promise<void>;
  /** SELFHOST-012: edit a scheduled task's cron / instruction in place (same task id). */
  editSchedule(taskId: string, patch: IScheduleEditPatch): Promise<void>;
}

/** Output-driven wakes. */
export interface IAgentJobMonitors {
  /**
   * FLOW-005: monitor a process's output and wake the agent with `agentInstruction` when a
   * line matches `matchPattern` (FLOW-004).
   */
  spawnMonitorWake(input: {
    label: string;
    command: string;
    matchPattern: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState>;
}

/** Reading a job's output. */
export interface IAgentJobLogs {
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
}

/** Aggregate: all 15 members remain source-compatible. Declare a role port instead of this. */
export interface IAgentJobHostContext
  extends
    IAgentJobDispatch,
    IAgentJobGroups,
    IAgentJobSchedules,
    IAgentJobMonitors,
    IAgentJobLogs {}
