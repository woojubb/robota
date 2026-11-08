/**
 * The `ICommandHostContext` role ports.
 *
 * See `session-roles.ts` for why this is a separate file.
 */

import type { ISessionUsageRecord } from './session/session-usage.js';
import type { IAgentJobHostContext } from './agent-job-roles.js';
import type { ICommandResult } from './command-result.js';
import type { ICommandHostAdapters } from './host-adapters.js';
import type {
  ICommandSkillActivationRequest,
  ICommandSkillListEntry,
  ICommandSessionReplayValidationReport,
  ICommandProductVocabulary,
  IUnknownCommandModuleName,
  TAutoCompactThresholdSource,
} from './host-context-types.js';
import type { ICommandSessionRuntime } from './session-roles.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointListing,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointUnreadableCounts,
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
import type { TAutoCompactThreshold } from '@robota-sdk/agent-session';
import type { IOutputStylePrompt } from '../context/output-style-prompt.js';
import type { IContextWindowState, IUserInteraction } from '@robota-sdk/agent-core';
import type {
  ICommandListEntry,
  TCommandInvocationSource,
  TCommandSurfaceLocality,
  ISkillResource,
} from '@robota-sdk/agent-interface-command';
import type {
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
} from '@robota-sdk/agent-interface-execution';
import type { IGoalState, IPlanArtifact } from '@robota-sdk/agent-interface-session';

/** Reaching the live session, and the whole-conversation operations that sit beside it. */
export interface ICommandHostSessionAccess {
  getSession(): ICommandSessionRuntime;
  /** Read the active response style id for the command listing. */
  getActiveOutputStyleId(): string;
  clearConversationHistory(): void;
  /**
   * Write a COPY of the live conversation as a new session record (fresh id, distinct
   * name, the parent's messages and assembled system message) and return its identity. A role-port
   * member rather than an `ICommandHostAdapters` entry because the session store is owned by the
   * session, not by the shell. The copy is not started here: `/fork` spawns the background job that
   * resumes it, carrying only the returned id.
   */
  forkSession(input?: { name?: string }): Promise<{ sessionId: string; name: string }>;
  /**
   * Required, and the host delegates to `computeSessionReplayValidationReport`.
   * It was an optional override with a framework-computed default and no implementor, which is
   * two declared paths with only one live. One owner, one path.
   */
  validateCurrentSessionReplayLog(): ICommandSessionReplayValidationReport;
  /**
   * Every usage record the session has persisted — its turns and any other model it consulted —
   * so a total read from here is the whole session's spend, each part priced on its own model.
   */
  getSessionUsage(): readonly ISessionUsageRecord[];
}

/** Reaching the agent-job capability, when the host has one. */
export interface ICommandHostAgentJobs {
  getAgentJobCapability(): IAgentJobHostContext | undefined;
}

/** Asking the user a question. */
export interface ICommandHostUserInteraction {
  /**
   * The injected "ask the user" port, or undefined when no interactive renderer is attached.
   * A command solicits a structured answer via `getUserInteraction()?.ask(request)`; absence means no
   * human is available (headless/automation, or a model-invoked command) — the command must handle it
   * as a cancellation, never a silent guess.
   */
  getUserInteraction(): IUserInteraction | undefined;
}

/**
 * Whether THIS session is running with no provider configured yet (setup mode).
 *
 * Exists for exactly one command (`/provider add`, deciding hot-swap vs. restart) — never inferred
 * from settings, because an ordinary session started from an env-default provider also has none
 * persisted. The member is optional so a host with no concept of setup mode costs nothing and is
 * correctly read as "not in it" (`?.() === true`), never mistaken for a required capability.
 */
export interface ICommandHostSetupState {
  isSetupRequired?(): boolean;
}

/** Re-applying preset-owned configuration to the live session. */
export interface ICommandHostPresetApplication {
  /** Apply an additive response style to the live system prompt. */
  applyOutputStyle(style: IOutputStylePrompt): void;
  /** Re-apply a preset persona to the live system prompt. */
  applyPersona(persona: string): void;
  /** Toggle the verify-before-done self-verification section on the live prompt. */
  applySelfVerification(enabled: boolean): void;
  /** Re-apply the preset's response language to the live system prompt. */
  applyResponseLanguage(language: string): void;
  /** Re-apply the preset's seeding system prompt to the live system prompt. */
  applyPresetSystemPrompt(text: string): void;
  /**
   * Re-apply command-module selection to the live session. Returns any
   * `enabled`/`disabled` names that matched no live command module so the `/preset`
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
  /**
   * Whether THIS invocation is provably on this machine. Optional so an older or
   * narrower host still satisfies this interface; a caller that needs it treats a missing method the
   * same as `'local'` (allow-by-default, matching the rest of the command layer).
   */
  getCommandSurfaceLocality?(): TCommandSurfaceLocality;
  /** Raw locality supplied by the carrier; absent is not evidence for granting new authority. */
  getCommandSurfaceLocalityEvidence?(): TCommandSurfaceLocality | undefined;
}

/** What commands and skills this host can dispatch. */
export interface ICommandHostCatalog {
  listCommands(): ICommandListEntry[];
  listSkills(): ICommandSkillListEntry[];
  /** Read only within an existing host-owned skill activation; never acquire authority here. */
  readSkillResource?(name: string, uri: string): Promise<ISkillResource>;
  executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null>;
}

/** The edit-checkpoint tree: inspection, restore, and branching. */
export interface ICommandHostCheckpoints {
  listEditCheckpoints(): IEditCheckpointSummary[];
  /** The session's checkpoints that `listEditCheckpoints` leaves out because they do not open. */
  unreadableEditCheckpoints?(): IEditCheckpointUnreadableCounts;
  /** Both of the above from one read of the session's checkpoints. */
  editCheckpointListing?(): IEditCheckpointListing;
  inspectEditCheckpoint(checkpointId: string): IEditCheckpointInspection;
  restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** List the checkpoint branch tips (leaf ids) via the neutral tree. */
  listCheckpointBranches(): string[];
  /** Fork a new branch from a past checkpoint (non-destructive restore). */
  forkCheckpointBranch(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  /** Switch the active branch to an existing checkpoint/branch tip. */
  switchCheckpointBranch(checkpointId: string): void;
}

/** Durable memory: what was used, what happened, and the store behind it. */
export interface ICommandHostMemory {
  getUsedMemoryReferences(): IMemoryReference[];
  recordMemoryEvent(event: IMemoryEvent): void;
  /**
   * The injected durable-memory port the `/memory` command reads/writes through, so a
   * surface that swaps the store is authoritative for command operations too (no split-brain). Must
   * return the SAME instance the session injected (SSOT for a stateful store). The
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
  /** Assign and begin pursuing an autonomous goal. */
  setGoal(objective: string, options?: IGoalStartOptions): Promise<IGoalState>;
  /** The current goal state, or null when no goal has been set. */
  getGoalState(): IGoalState | null;
  /** Cancel an in-flight goal; returns the stopped state or null. */
  cancelGoal(): IGoalState | null;
}

/** The plan lifecycle, including the mode flip approval performs. */
export interface ICommandHostPlan {
  /** Start a plan (draft for review; keeps `plan` mode). */
  setPlan(objective: string, steps?: readonly string[]): Promise<IPlanArtifact>;
  /** The current plan artifact, or null when none started. */
  getPlanState(): IPlanArtifact | null;
  /** Approve the plan; applies the `plan → acceptEdits` mode flip. */
  approvePlan(): IPlanArtifact;
  /** Revert the plan to drafting; returns mode to `plan`. */
  revertPlan(): IPlanArtifact;
}

/** Handing the real terminal to a child process. */
export interface ICommandHostTerminalHandoff {
  /**
   * Whether the active transport can hand the real terminal to a child process. `false`
   * when there is no interactive TTY (e.g. headless). `runWithTerminal` is required and present
   * either way; whether a handoff is possible is a VALUE this returns, not a member that is missing.
   */
  canHandoffTerminal(): boolean;
  /**
   * Suspend the display, run `fn` (which spawns a child with inherited stdio), then
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

/** Optional product names used only when commands need to suggest a terminal command. */
export interface ICommandHostProductVocabulary {
  getCommandProductVocabulary?(): ICommandProductVocabulary | undefined;
}

/** Aggregate: all 48 members remain source-compatible. Declare a role port instead of this. */
export interface ICommandHostContext
  extends
    ICommandHostSessionAccess,
    ICommandHostAgentJobs,
    ICommandHostUserInteraction,
    ICommandHostSetupState,
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
    ICommandHostAdapterAccess,
    ICommandHostProductVocabulary {}
