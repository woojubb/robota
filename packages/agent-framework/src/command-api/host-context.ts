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
import type { TAutoCompactThreshold } from './context/context-command-api.js';
import type {
  IContextWindowState,
  IHistoryEntry,
  IUserInteraction,
  TModelEffort,
  TPermissionMode,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
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

export interface ICommandSessionRuntime {
  clearHistory(): void;
  compact(instructions?: string): Promise<void>;
  getContextState(): IContextWindowState;
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionId(): string;
  getMessageCount(): number;
  getSessionAllowedTools(): readonly string[];
  getAutoCompactThreshold(): number | false;
  getFullHistory(): IHistoryEntry[];
  getHistory(): TUniversalMessage[];
  setAutoCompactThreshold?(threshold: TAutoCompactThreshold): void;
  getSessionTokenUsage?(): { inputTokens: number; outputTokens: number } | undefined;
  getModelId?(): string | undefined;
  /**
   * Re-apply model/effort/temperature/maxOutputTokens to the live session (PRESET-013).
   * May be async: the runtime ensures the agent is fully initialized before mutating its model
   * configuration, so callers must await the result.
   */
  applyModelOptions?(options: IModelReapplyOptions): void | Promise<void>;
  /** Read the active preset id (PRESET-011 runtime state). */
  getActivePresetId?(): string;
  /** Set the active preset id (PRESET-011 runtime state — pure state, no option re-application). */
  setActivePresetId?(id: string): void;
  /** Toggle subagent dispatch live for the running session (PRESET-016 runtime gate). */
  setParallelSubagentsEnabled?(enabled: boolean): void;
}

export interface ICommandSessionReplayValidationReport {
  logFile: string;
  entryCount: number;
  validation: ISessionReplayValidationResult;
}

export interface ICommandHostContext {
  clearConversationHistory?(): void;
  validateCurrentSessionReplayLog?(): ICommandSessionReplayValidationReport;
  getAgentJobCapability?(): IAgentJobHostContext | undefined;
  /**
   * CMD-004: the injected "ask the user" port, or undefined when no interactive renderer is attached.
   * A command solicits a structured answer via `getUserInteraction()?.ask(request)`; absence means no
   * human is available (headless/automation, or a model-invoked command) — the command must handle it
   * as a cancellation, never a silent guess.
   */
  getUserInteraction?(): IUserInteraction | undefined;
  getSession(): ICommandSessionRuntime;
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
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): TAutoCompactThreshold;
  getAutoCompactThresholdSource?(): TAutoCompactThresholdSource;
  setAutoCompactThreshold?(
    threshold: TAutoCompactThreshold,
    source?: TAutoCompactThresholdSource,
  ): void;
  getCommandHostAdapters?(): ICommandHostAdapters;
  compactContext(instructions?: string): Promise<void>;
  listContextReferences?(): IContextReferenceItem[];
  addContextReference?(path: string): Promise<IContextReferenceAddResult>;
  removeContextReference?(path: string): IContextReferenceRemoveResult;
  clearContextReferences?(): IContextReferenceClearResult;
  getCwd(): string;
  getCommandInvocationSource?(): TCommandInvocationSource;
  listCommands?(): ICommandListEntry[];
  listSkills?(): ICommandSkillListEntry[];
  executeSkillCommandByName?(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null>;
  listEditCheckpoints(): IEditCheckpointSummary[];
  inspectEditCheckpoint?(checkpointId: string): IEditCheckpointInspection;
  restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  getUsedMemoryReferences(): IMemoryReference[];
  recordMemoryEvent(event: IMemoryEvent): void;
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
  /** GOAL-001 — assign and begin pursuing an autonomous goal. */
  setGoal?(objective: string, options?: IGoalStartOptions): Promise<IGoalState>;
  /** GOAL-001 — the current goal state, or null when no goal has been set. */
  getGoalState?(): IGoalState | null;
  /** GOAL-001 — cancel an in-flight goal; returns the stopped state or null. */
  cancelGoal?(): IGoalState | null;
  /** SELFHOST-002 — start a plan (draft for review; keeps `plan` mode). */
  setPlan?(objective: string, steps?: readonly string[]): Promise<IPlanArtifact>;
  /** SELFHOST-002 — the current plan artifact, or null when none started. */
  getPlanState?(): IPlanArtifact | null;
  /** SELFHOST-002 — approve the plan; applies the `plan → acceptEdits` mode flip. */
  approvePlan?(): IPlanArtifact;
  /** SELFHOST-002 — revert the plan to drafting; returns mode to `plan`. */
  revertPlan?(): IPlanArtifact;
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

export interface IAgentJobHostContext {
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
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;
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
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
}
