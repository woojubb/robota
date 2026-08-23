/**
 * SessionExecutionController — owns execution lifecycle state and methods
 * for InteractiveSession.
 *
 * Manages: execution claim, streaming text, active tools, pending queue,
 * shutting-down flag, and all private execution lifecycle methods.
 */

import {
  createUserMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';

import { InteractiveExecutionClaimOwner } from './interactive-execution-claim.js';
import { checkAndRefreshContextIfStale } from './interactive-session-context-refresh.js';
import {
  projectCompactEvent,
  projectForkSkillResult,
  projectToolExecution,
} from './interactive-session-execution-events.js';
import { PendingInputQueue } from './interactive-session-pending-queue.js';
import { capturePostTurnMemory } from './interactive-session-post-turn-memory.js';
import { executePromptTurn, promptTurnAttribution } from './interactive-session-prompt.js';
import { STREAMING_FLUSH_INTERVAL_MS } from './interactive-session-streaming.js';
import { TurnSettlerRegistry } from './turn-settler-registry.js';
import { humanizeApiError } from '../utils/error-humanizer.js';

import type { IExecutionClaim } from './interactive-execution-claim.js';
import type {
  IExecutionControllerCallbacks,
  ITurnOptions,
  IQueuedInput,
  TResumeQueuedTurnFn,
} from './interactive-session-execution-contracts.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type { SessionSkillRouter } from './interactive-session-skill-router.js';
import type { IToolState } from './types.js';
import type { IExecutionResult } from './types.js';
import type { TExecutionWorkspaceUpdateCause } from '../background-tasks/index.js';
import type { ICommand, ICommandResult, ISkillExecutionResult } from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TDriverId, TTurnSource } from '@robota-sdk/agent-interface-session';
import type { ICompactEvent } from '@robota-sdk/agent-interface-session';

export type { TTurnSource };

// The contracts moved to their own file when this one grew past its size baseline; re-exported so
// every existing importer keeps working and the split is not a breaking change to the package.
export type {
  IExecutionControllerCallbacks,
  ITurnOptions,
  IQueuedInput,
  TResumeQueuedTurnFn,
  TSubmitFn,
} from './interactive-session-execution-contracts.js';

export class SessionExecutionController {
  private readonly executionClaim: InteractiveExecutionClaimOwner;
  streamingText = '';
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  activeTools: IToolState[] = [];
  /** REMOTE-014 E5: co-drive input queue (same-driver coalesces to the tail, cross-driver appends). */
  readonly pending = new PendingInputQueue({
    refuse: (turnId, reason) => this.turns.refuse(turnId, reason),
    releaseWake: (wakeTaskId) => this.wakeTaskIds.delete(wakeTaskId),
  });
  /** REMOTE-014 E5: the driver id of the ACTIVE turn (null when idle) — read at event-emit time for attribution. */
  activeDriverId: TDriverId | null = null;
  shuttingDown = false;

  /** FLOW-002: background task ids with an in-flight wake turn (coalesces duplicate wakes). */
  readonly wakeTaskIds = new Set<string>();

  constructor(
    private readonly histTracker: SessionHistoryTracker,
    private readonly skillRouter: SessionSkillRouter,
    private readonly callbacks: IExecutionControllerCallbacks,
  ) {
    this.executionClaim = new InteractiveExecutionClaimOwner([
      () => this.callbacks.persistSession(),
      () => this.callbacks.emit('thinking', false),
      () => this.emitExecutionWorkspaceUpdated('main_thread'),
    ]);
  }

  /** RUNTIME-003: the registry that makes `ITurnHandle.completed` able to promise it settles. */
  readonly turns = new TurnSettlerRegistry();

  get executing(): boolean {
    return this.executionClaim.active;
  }

  /** The HEAD queued prompt (next to run), or null — backward-compatible single-prompt read. */
  get pendingPrompt(): string | null {
    return this.pending.head;
  }

  /** REMOTE-014 E5: total queued inputs (0 when idle) — a co-drive "N queued" hint. */
  pendingCount(): number {
    return this.pending.size;
  }

  enqueuePending(entry: IQueuedInput): 'queued' | 'coalesced' | 'dropped' {
    return this.pending.enqueue(entry);
  }

  clearPendingQueue(): TDriverId[] {
    return this.pending.clear();
  }

  clearStreaming(): void {
    this.streamingText = '';
    this.activeTools = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  flushStreaming(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  handleTextDelta(delta: string): void {
    this.streamingText += delta;
    this.callbacks.emit('text_delta', delta);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
      }, STREAMING_FLUSH_INTERVAL_MS);
    }
  }

  handleCompactEvent(event: ICompactEvent): void {
    projectCompactEvent(this.histTracker, this.callbacks, event);
  }
  handleToolExecution(event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }): void {
    this.activeTools = projectToolExecution(
      this.activeTools,
      this.histTracker.getHistory(),
      this.callbacks,
      (activeTools) => void (this.activeTools = activeTools),
      event,
    );
  }

  emitExecutionWorkspaceUpdated(cause: TExecutionWorkspaceUpdateCause, entryId?: string): void {
    const session = this.callbacks.getSession();
    if (!session) return;
    this.callbacks.emit('execution_workspace_event', {
      type: 'execution_workspace_updated',
      cause,
      ...(entryId ? { entryId } : {}),
      snapshot: this.callbacks.getExecutionWorkspaceSnapshot(),
    });
  }

  // `protected`, not `private`: the queue's resubmission path is what settles a queued caller's
  // handle, and a case that drives it directly is the only way to reach the throw-on-resubmit
  // outcome without standing up a whole session and a real shutdown race. A subclass is what the
  // modifier permits — the same reasoning the settles suite already applies to `enqueuePending`.
  protected drainPendingQueue(resumeQueuedTurn: TResumeQueuedTurnFn): void {
    if (!this.shuttingDown && this.pending.size > 0) {
      // Dequeue the HEAD (submission order); resubmit it. Its wakeTaskId is NOT released here — the turn it
      // starts will release it on completion (or `clearPendingQueue` if aborted).
      const head = this.pending.shift() as IQueuedInput;
      // RUNTIME-006: resume the complete accepted entry through the private execution path. The
      // entry's own required id is what every settle point uses; public submit is never re-entered.
      // Start in this tick: deferring leaves `executing === false`, letting a public submission
      // start before the queued turn claims continuous execution ownership.
      let resumed: Promise<void>;
      try {
        resumed = resumeQueuedTurn(head);
      } catch (error) {
        this.turns.fail(head.turnId, error instanceof Error ? error : new Error(String(error)));
        return;
      }
      void resumed.catch((error: unknown) => {
        this.turns.fail(head.turnId, error instanceof Error ? error : new Error(String(error)));
      });
    }
  }

  async executePrompt(
    input: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    agentsFileEntries: IContextFileEntry[],
    projectNotesFileEntries: IContextFileEntry[],
    rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null,
    setEntries: (agents: IContextFileEntry[], claude: IContextFileEntry[]) => void,
    resumeQueuedTurn: TResumeQueuedTurnFn,
    turnId: string,
    turnOptions: ITurnOptions = {},
  ): Promise<void> {
    // RUNTIME-12: claim the turn SYNCHRONOUSLY at entry. The caller's `if (execCtrl.executing)` gate
    // (interactive-session.submit) and this claim are synchronous, so a second concurrent submit
    // observes `executing` and coalesces to the pending queue instead of BOTH starting a turn. (Previously
    // set only AFTER the awaited checkAndRefreshContextIfStale below, leaving a two-await window where both
    // entries saw idle.) The `finally` always releases it — including if the refresh throws, which is why
    // checkAndRefreshContextIfStale now runs INSIDE the try.
    let executionClaim: IExecutionClaim;
    try {
      executionClaim = this.executionClaim.acquire('prompt');
    } catch (error) {
      this.turns.fail(turnId, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    // RUNTIME-003: which submission this turn belongs to; the handle minted then settles here.
    // REMOTE-014 E5: capture the ACTIVE turn's driver so event/prompt emitters can attribute to it.
    this.activeDriverId = turnOptions.driverId ?? null;
    // SELFHOST-008 P2: stash the completed turn's result so post-turn capture can run in the `finally`
    // BEFORE persistSession() (awaiting inside `onComplete` would not order there — it is not awaited).
    let completedResult: IExecutionResult | undefined;
    // RUNTIME-003: what this turn ended with. `completedResult` cannot stand in — it is the
    // COMPLETED path only, and a handle must settle for an interrupted turn too.
    let terminalResult: IExecutionResult | undefined;
    let turnError: Error | undefined;
    let ephemeralSystemContext: string | undefined;
    try {
      await checkAndRefreshContextIfStale(
        agentsFileEntries,
        projectNotesFileEntries,
        rebuildSystemMessage,
        this.callbacks.getProjectAccess(),
        setEntries,
        () => this.callbacks.getSessionOrThrow(),
        (event: string, payload: unknown) => this.callbacks.emit(event, payload),
      );
      this.clearStreaming();
      // FLOW-002: surface the turn origin so consumers (hooks, TUI) can distinguish a human
      // prompt from an agent-wakeup re-entry.
      this.callbacks.emit('turn_source', turnOptions.turnSource ?? 'user');
      this.callbacks.emit('user_message', displayInput ?? input);
      this.callbacks.emit('thinking', true);
      if (this.callbacks.recallMemory) {
        try {
          const recalled = await this.callbacks.recallMemory(input);
          if (recalled && recalled.trim().length > 0) ephemeralSystemContext = recalled;
        } catch {
          // allow-fallback: per-turn recall is best-effort over the always-present startup memory; a recall
          // error skips ephemeral injection and the turn proceeds normally (SELFHOST-008 P3 declared degradation).
          ephemeralSystemContext = undefined;
        }
      }
      await executePromptTurn(input, displayInput, rawInput, {
        ...promptTurnAttribution(ephemeralSystemContext, turnOptions.driverId),
        getSession: () => this.callbacks.getSessionOrThrow(),
        getCwd: () => this.callbacks.getCwd(),
        getProjectAccess: () => this.callbacks.getProjectAccess(),
        getHistory: () => this.histTracker.getHistory(),
        getContextReferences: () => this.histTracker.listInjectionContextReferences(),
        getActiveTools: () => this.activeTools,
        resetUsedMemoryReferences: () => this.histTracker.resetUsedMemoryReferences(),
        recordContextReferenceUsage: (r) => this.histTracker.recordContextReferenceUsage(r),
        recordPromptContextReferences: (r) => this.histTracker.recordPromptContextReferences(r),
        beginEditCheckpointTurn: (p) => this.histTracker.beginEditCheckpointTurn(p),
        flushStreaming: () => this.flushStreaming(),
        clearStreaming: () => this.clearStreaming(),
        getStreamingText: () => this.streamingText,
        onWorkspaceUpdated: () => this.emitExecutionWorkspaceUpdated('main_thread'),
        onComplete: (result: IExecutionResult) => {
          completedResult = result; // stash for post-turn capture in the `finally`
          terminalResult = result;
          this.callbacks.emit('complete', result);
        },
        onInterrupted: (result: IExecutionResult) => {
          // RUNTIME-003: an interrupted turn RAN — resolve, do not reject.
          terminalResult = result;
          this.callbacks.emit('interrupted', result);
        },
        onError: (err: Error) => {
          turnError = err;
          this.callbacks.emit('error', err);
        },
        onContextUpdate: () => {
          this.callbacks.emit('context_update', this.callbacks.getContextState());
        },
      });
    } catch (error) {
      // RUNTIME-003: the REAL error, not the generic fallback below.
      //
      // `executePromptTurn` catches its own throws and routes them to `onError`, so `turnError` is
      // set for anything that happens INSIDE it. Everything before it in this `try` is not covered:
      // the `checkAndRefreshContextIfStale` await, a synchronous listener on one of the `emit`
      // calls, the recall block's own rethrow. Review found that such a throw left both
      // `terminalResult` and `turnError` undefined, so the handle rejected with "the turn ended
      // without a result" — a message that names the symptom and destroys the cause.
      //
      // Rethrown, so callers of `executePrompt` see exactly what they saw before. The only thing
      // this changes is WHAT the handle rejects with.
      turnError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      try {
        await this.histTracker.finalizeEditCheckpointTurn();
      } catch (error) {
        this.callbacks.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
      // SELFHOST-008 P2: post-turn auto-capture, awaited here so its events land in THIS turn's record.
      await capturePostTurnMemory({
        capture: this.callbacks.captureMemory,
        completedResult,
        turnSource: turnOptions.turnSource,
        userMessage: displayInput ?? input,
        record: (event) => this.histTracker.recordMemoryEvent(event),
        onError: (error) => this.callbacks.emit('error', error),
      });
      // RUNTIME-003: settled BEFORE draining, in the `finally` that always runs — so a caller is
      // answered by ITS turn, and a turn that threw where onError never saw still settles.
      if (terminalResult !== undefined) this.turns.settle(turnId, terminalResult);
      else this.turns.fail(turnId, turnError ?? new Error('the turn ended without a result'));
      this.activeDriverId = null; // REMOTE-014 E5: turn ended — events after this are not turn-authored
      // FLOW-002: the wake for this task id is no longer in flight; allow future wakes to inject.
      if (turnOptions.wakeTaskId !== undefined) this.wakeTaskIds.delete(turnOptions.wakeTaskId);
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  async executeForkSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    qualifiedName: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
    resumeQueuedTurn: TResumeQueuedTurnFn,
  ): Promise<ISkillExecutionResult> {
    if (this.executing) {
      throw new Error('Cannot execute fork skill while another prompt is running.');
    }
    const executionClaim = this.executionClaim.acquire('fork-skill');

    try {
      this.clearStreaming();
      this.callbacks.emit('thinking', true);
      this.histTracker.append(
        messageToHistoryEntry(createUserMessage(displayInput ?? `/${skill.name}`)),
      );
      this.emitExecutionWorkspaceUpdated('main_thread');
      const result = await this.skillRouter.executeSkillWithActivation(
        skill,
        args,
        invocation,
        qualifiedName,
      );
      await this.applyForkSkillResult(result.result ?? '(empty response)');
      return result;
    } catch (err) {
      // allow-fallback: fork-skill errors must not crash the main execution thread
      const error = err instanceof Error ? err : new Error(String(err));
      this.histTracker.append(
        messageToHistoryEntry(createSystemMessage(`Error: ${humanizeApiError(error)}`)),
      );
      this.callbacks.emit('error', error);
      return { mode: 'fork', result: '' };
    } finally {
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  async executeForegroundCommand(
    execute: () => Promise<ICommandResult>,
    resumeQueuedTurn: TResumeQueuedTurnFn,
  ): Promise<ICommandResult> {
    let executionClaim: IExecutionClaim;
    try {
      executionClaim = this.executionClaim.acquire('foreground-command');
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      this.clearStreaming();
      this.callbacks.emit('thinking', true);
      this.emitExecutionWorkspaceUpdated('main_thread');
      const result = await execute();
      this.callbacks.emit('context_update', this.callbacks.getContextState());
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Error: ${errMsg}` };
    } finally {
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  async applyForkSkillResult(result: string): Promise<void> {
    projectForkSkillResult(
      result,
      this.activeTools,
      this.histTracker,
      this.callbacks,
      () => this.flushStreaming(),
      () => this.clearStreaming(),
    );
  }
}
