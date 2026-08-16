/**
 * ARCH-029: the `ICommandHostContext` role ports.
 *
 * See `session-roles.ts` for why this is a separate file.
 */

import type { IAgentJobHostContext } from './agent-job-roles.js';
import type { ICommandResult } from './command-result.js';
import type { ICommandHostAdapters } from './host-adapters.js';
import type {
  ICommandSkillActivationRequest,
  ICommandSkillListEntry,
  ICommandSessionReplayValidationReport,
  IUnknownCommandModuleName,
  TAutoCompactThresholdSource,
} from './host-context.js';
import type { ICommandSessionRuntime } from './session-roles.js';
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
import type { IContextWindowState, IUserInteraction } from '@robota-sdk/agent-core';
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
} from '@robota-sdk/agent-interface-transport';

/** Reaching the live session, and the whole-conversation operations that sit beside it. */
export interface ICommandHostSessionAccess {
  getSession(): ICommandSessionRuntime;
  clearConversationHistory(): void;
  /**
   * ARCH-029 TC-08 — required, and the host delegates to `computeSessionReplayValidationReport`.
   * It was an optional override with a framework-computed default and no implementor, which is
   * two declared paths with only one live. One owner, one path.
   */
  validateCurrentSessionReplayLog(): ICommandSessionReplayValidationReport;
}

/** Reaching the agent-job capability, when the host has one. */
export interface ICommandHostAgentJobs {
  getAgentJobCapability(): IAgentJobHostContext | undefined;
}

/** Asking the user a question. */
export interface ICommandHostUserInteraction {
  /**
   * CMD-004: the injected "ask the user" port, or undefined when no interactive renderer is attached.
   * A command solicits a structured answer via `getUserInteraction()?.ask(request)`; absence means no
   * human is available (headless/automation, or a model-invoked command) — the command must handle it
   * as a cancellation, never a silent guess.
   */
  getUserInteraction(): IUserInteraction | undefined;
}

/** Re-applying preset-owned configuration to the live session. */
export interface ICommandHostPresetApplication {
  /** PRESET-014 — re-apply a preset persona to the live system prompt. */
  applyPersona(persona: string): void;
  /** PRESET-017 — toggle the verify-before-done self-verification section on the live prompt. */
  applySelfVerification(enabled: boolean): void;
  /**
   * PRESET-015 — re-apply command-module selection to the live session. Returns any
   * `enabled`/`disabled` names that matched no live command module (INFRA-032) so the `/preset`
   * command can surface them as a non-fatal notice; an empty array means every name matched.
   */
  applyCommandModuleSelection(
    enabled: readonly string[] | undefined,
    disabled: readonly string[] | undefined,
  ): readonly IUnknownCommandModuleName[];
}

/** The host's view of the context window and its compaction. */
export interface ICommandHostContextWindow {
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): TAutoCompactThreshold;
  getAutoCompactThresholdSource(): TAutoCompactThresholdSource;
  setAutoCompactThreshold(
    threshold: TAutoCompactThreshold,
    source?: TAutoCompactThresholdSource,
  ): void;
  compactContext(instructions?: string): Promise<void>;
}

/** The files pinned into context by reference. */
export interface ICommandHostContextReferences {
  listContextReferences(): IContextReferenceItem[];
  addContextReference(path: string): Promise<IContextReferenceAddResult>;
  removeContextReference(path: string): IContextReferenceRemoveResult;
  clearContextReferences(): IContextReferenceClearResult;
}

/** Where the command is running, and how it was invoked. */
export interface ICommandHostWorkspace {
  getCwd(): string;
  getCommandInvocationSource(): TCommandInvocationSource;
}

/** What commands and skills this host can dispatch. */
export interface ICommandHostCatalog {
  listCommands(): ICommandListEntry[];
  listSkills(): ICommandSkillListEntry[];
  executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null>;
}

/** The edit-checkpoint tree: inspection, restore, and branching. */
export interface ICommandHostCheckpoints {
  listEditCheckpoints(): IEditCheckpointSummary[];
  inspectEditCheckpoint(checkpointId: string): IEditCheckpointInspection;
  restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** SELFHOST-007: list the checkpoint branch tips (leaf ids) via the neutral tree. */
  listCheckpointBranches(): string[];
  /** SELFHOST-007: fork a new branch from a past checkpoint (non-destructive restore). */
  forkCheckpointBranch(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** SELFHOST-007: switch the active branch to an existing checkpoint/branch tip. */
  switchCheckpointBranch(checkpointId: string): void;
}

/** Durable memory: what was used, what happened, and the store behind it. */
export interface ICommandHostMemory {
  getUsedMemoryReferences(): IMemoryReference[];
  recordMemoryEvent(event: IMemoryEvent): void;
  /**
   * SELFHOST-008 P1R — the injected durable-memory port the `/memory` command reads/writes through, so a
   * surface that swaps the store is authoritative for command operations too (no split-brain). Must
   * return the SAME instance the session injected (SSOT for a stateful store). ARCH-029 TC-09: the
   * "when absent, default to the neutral fs store over `getCwd()`" fallback is GONE — the one
   * production host already built and cached that store itself, so the framework was re-deriving
   * what the host owned.
   */
  getMemoryStore(): IMemoryStore;
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
  setGoal(objective: string, options?: IGoalStartOptions): Promise<IGoalState>;
  /** GOAL-001 — the current goal state, or null when no goal has been set. */
  getGoalState(): IGoalState | null;
  /** GOAL-001 — cancel an in-flight goal; returns the stopped state or null. */
  cancelGoal(): IGoalState | null;
}

/** The plan lifecycle, including the mode flip approval performs. */
export interface ICommandHostPlan {
  /** SELFHOST-002 — start a plan (draft for review; keeps `plan` mode). */
  setPlan(objective: string, steps?: readonly string[]): Promise<IPlanArtifact>;
  /** SELFHOST-002 — the current plan artifact, or null when none started. */
  getPlanState(): IPlanArtifact | null;
  /** SELFHOST-002 — approve the plan; applies the `plan → acceptEdits` mode flip. */
  approvePlan(): IPlanArtifact;
  /** SELFHOST-002 — revert the plan to drafting; returns mode to `plan`. */
  revertPlan(): IPlanArtifact;
}

/** Handing the real terminal to a child process. */
export interface ICommandHostTerminalHandoff {
  /**
   * TERM-001 — whether the active transport can hand the real terminal to a child process. `false`
   * when there is no interactive TTY (e.g. headless). `runWithTerminal` is required and present
   * either way; whether a handoff is possible is a VALUE this returns, not a member that is missing.
   */
  canHandoffTerminal(): boolean;
  /**
   * TERM-001 — suspend the display, run `fn` (which spawns a child with inherited stdio), then
   * restore the display. Exclusive (one handoff at a time) and abort-safe; rejects without running
   * `fn` when a handoff is not possible. The framework owns this orchestration; the transport
   * implements the underlying suspend/resume.
   */
  runWithTerminal<T>(fn: () => Promise<T>): Promise<T>;
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
