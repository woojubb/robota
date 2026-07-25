/**
 * SessionExecutionController — owns execution lifecycle state and methods
 * for InteractiveSession.
 *
 * Manages: executing flag, streaming text, active tools, pending queue,
 * shutting-down flag, and all private execution lifecycle methods.
 */

import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';

import { checkAndRefreshContextIfStale } from './interactive-session-context-refresh.js';
import { executePromptTurn } from './interactive-session-prompt.js';
import {
  STREAMING_FLUSH_INTERVAL_MS,
  pushToolSummaryToHistory,
  applyToolStart,
  applyToolEnd,
} from './interactive-session-streaming.js';
import { humanizeApiError } from '../utils/error-humanizer.js';

import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type { SessionSkillRouter } from './interactive-session-skill-router.js';
import type { IToolState } from './types.js';
import type { IExecutionResult } from './types.js';
import type {
  IExecutionWorkspaceSnapshot,
  TExecutionWorkspaceUpdateCause,
} from '../background-tasks/index.js';
import type { ICommand, ICommandResult, ISkillExecutionResult } from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import type { TDriverId, TTurnSource } from '@robota-sdk/agent-interface-transport';
import type { ICompactEvent } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

export type { TTurnSource };

export interface IExecutionControllerCallbacks {
  getSession: () => Session;
  getSessionOrThrow: () => Session;
  getCwd: () => string;
  getContextState: () => IContextWindowState;
  getExecutionWorkspaceSnapshot: () => IExecutionWorkspaceSnapshot;
  emit: <E extends string>(event: E, ...args: unknown[]) => void;
  persistSession: () => void;
  /**
   * SELFHOST-008 P2: optional post-turn auto-capture. When set (surface supplied `automaticMemory`), it is
   * `await`ed in the executePrompt `finally` immediately BEFORE `persistSession()` on the completed-turn path,
   * so the returned `IMemoryEvent`s (recorded via the history tracker) land in THIS turn's persisted record.
   * Absent ⇒ capture OFF. It extracts/evaluates/curates through the injected `IMemoryStore` and returns the
   * events; the controller records them + swallows any error to a skip (a capture bug never breaks the turn).
   */
  captureMemory?: (input: {
    userMessage: string;
    assistantMessage: string;
  }) => Promise<IMemoryEvent[]>;
  /**
   * SELFHOST-008 P3: optional per-turn recall. When set (surface supplied a `recallMemory` policy), it is
   * called at turn START with the turn's input and returns a rendered `<recalled-memory>` block (or '') to
   * inject EPHEMERALLY into that turn's model call (never persisted). Absent ⇒ recall OFF (startup-only
   * injection). The controller guards this call — a recall failure skips injection, never breaks the turn.
   */
  recallMemory?: (query: string) => Promise<string>;
}

/** Options threaded through submit/executePrompt for non-user turns (FLOW-002). */
export interface ITurnOptions {
  turnSource?: TTurnSource;
  /** When set, the in-flight wake for this background task id is cleared on turn completion. */
  wakeTaskId?: string;
  /** REMOTE-014 E5: the SERVER-ASSIGNED driver id for this turn (co-drive attribution; display-only). */
  driverId?: TDriverId;
}

/** REMOTE-014 E5: one queued input awaiting its turn (attributed). */
export interface IQueuedInput {
  readonly input: string;
  readonly displayInput?: string;
  readonly rawInput?: string;
  readonly options: ITurnOptions;
}

/** REMOTE-014 E5: max co-drive queue depth — beyond this, drop-newest with an attributed notice. */
export const MAX_PENDING_QUEUE_DEPTH = 32;

/** A submit callback that optionally carries turn options (default = user turn). */
export type TSubmitFn = (
  prompt: string,
  displayInput?: string,
  rawInput?: string,
  options?: ITurnOptions,
) => Promise<void>;
export class SessionExecutionController {
  executing = false;
  streamingText = '';
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  activeTools: IToolState[] = [];
  /** REMOTE-014 E5: co-drive input queue (same-driver coalesces to the tail, cross-driver appends). */
  pendingQueue: IQueuedInput[] = [];
  /** REMOTE-014 E5: the driver id of the ACTIVE turn (null when idle) — read at event-emit time for attribution. */
  activeDriverId: TDriverId | null = null;
  shuttingDown = false;

  /** FLOW-002: background task ids with an in-flight wake turn (coalesces duplicate wakes). */
  readonly wakeTaskIds = new Set<string>();

  constructor(
    private readonly histTracker: SessionHistoryTracker,
    private readonly skillRouter: SessionSkillRouter,
    private readonly callbacks: IExecutionControllerCallbacks,
  ) {}

  /** The HEAD queued prompt (next to run), or null — backward-compatible single-prompt read. */
  get pendingPrompt(): string | null {
    return this.pendingQueue[0]?.input ?? null;
  }

  /** REMOTE-014 E5: total queued inputs (0 when idle) — a co-drive "N queued" hint. */
  pendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * REMOTE-014 E5: enqueue an input while a turn is executing. Same-driver-as-tail COALESCES (tail-replace —
   * preserves today's editable-pending, last-wins-per-driver semantics + caps a single flooder); a different
   * driver APPENDS (never clobbers another's input). At capacity, drop-newest and return 'dropped' (the caller
   * emits an attributed notice). Releases a coalesced-away / dropped entry's `wakeTaskId` (CORE-024).
   */
  enqueuePending(entry: IQueuedInput): 'queued' | 'coalesced' | 'dropped' {
    const tail = this.pendingQueue[this.pendingQueue.length - 1];
    if (tail && tail.options.driverId === entry.options.driverId) {
      if (
        tail.options.wakeTaskId !== undefined &&
        tail.options.wakeTaskId !== entry.options.wakeTaskId
      ) {
        this.wakeTaskIds.delete(tail.options.wakeTaskId);
      }
      this.pendingQueue[this.pendingQueue.length - 1] = entry;
      return 'coalesced';
    }
    if (this.pendingQueue.length >= MAX_PENDING_QUEUE_DEPTH) {
      if (entry.options.wakeTaskId !== undefined) this.wakeTaskIds.delete(entry.options.wakeTaskId);
      return 'dropped';
    }
    this.pendingQueue.push(entry);
    return 'queued';
  }

  /**
   * Clear the WHOLE queue, releasing EVERY entry's `wakeTaskId` (CORE-024/RUNTIME-19 — a dropped wake must free
   * its gate or that task can never wake again). Returns the distinct driver ids whose input was cleared, so
   * the caller can emit an attributed `cancelled by <id>` notice (E5 co-drive).
   */
  clearPendingQueue(): TDriverId[] {
    const drivers: TDriverId[] = [];
    for (const entry of this.pendingQueue) {
      if (entry.options.wakeTaskId !== undefined) this.wakeTaskIds.delete(entry.options.wakeTaskId);
      const driver = entry.options.driverId;
      if (driver !== undefined && !drivers.includes(driver)) drivers.push(driver);
    }
    this.pendingQueue = [];
    return drivers;
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
    if (event.trigger === 'auto') {
      this.histTracker.append(
        messageToHistoryEntry(
          createSystemMessage(
            `Auto compacted context: ${Math.round(event.before.usedPercentage)}% -> ${Math.round(event.after.usedPercentage)}%`,
          ),
        ),
      );
    }
    this.callbacks.emit('compact', event);
    this.callbacks.emit('context_update', event.after);
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
    const streamingState = {
      activeTools: this.activeTools,
      history: this.histTracker.getHistory(),
    };
    if (event.type === 'start') {
      const toolState = applyToolStart(streamingState, event);
      this.activeTools = streamingState.activeTools;
      this.callbacks.emit('tool_start', toolState);
    } else {
      const finished = applyToolEnd(streamingState, event);
      this.activeTools = streamingState.activeTools;
      if (finished) this.callbacks.emit('tool_end', finished);
    }
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

  private drainPendingQueue(submit: TSubmitFn): void {
    if (!this.shuttingDown && this.pendingQueue.length > 0) {
      // Dequeue the HEAD (submission order); resubmit it. Its wakeTaskId is NOT released here — the turn it
      // starts will release it on completion (or `clearPendingQueue` if aborted).
      const head = this.pendingQueue.shift() as IQueuedInput;
      setTimeout(() => void submit(head.input, head.displayInput, head.rawInput, head.options), 0);
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
    submit: TSubmitFn,
    turnOptions: ITurnOptions = {},
  ): Promise<void> {
    // RUNTIME-12: claim the turn SYNCHRONOUSLY at entry. The caller's `if (execCtrl.executing)` gate
    // (interactive-session.submit) and this assignment are synchronous, so a second concurrent submit
    // observes `executing` and coalesces to the pending queue instead of BOTH starting a turn. (Previously
    // set only AFTER the awaited checkAndRefreshContextIfStale below, leaving a two-await window where both
    // entries saw idle.) The `finally` always releases it — including if the refresh throws, which is why
    // checkAndRefreshContextIfStale now runs INSIDE the try.
    this.executing = true;
    // REMOTE-014 E5: capture the ACTIVE turn's driver so event/prompt emitters can attribute to it.
    this.activeDriverId = turnOptions.driverId ?? null;
    // SELFHOST-008 P2: stash the completed turn's result so post-turn capture can run in the `finally`
    // BEFORE persistSession() (awaiting inside `onComplete` would not order there — it is not awaited).
    let completedResult: IExecutionResult | undefined;
    // SELFHOST-008 P3: per-turn recall — the ephemeral `<recalled-memory>` block (query = input) computed
    // BEFORE the turn's model call, guarded so a recall failure skips injection but never breaks the turn.
    let ephemeralSystemContext: string | undefined;
    try {
      await checkAndRefreshContextIfStale(
        agentsFileEntries,
        projectNotesFileEntries,
        rebuildSystemMessage,
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
        ...(ephemeralSystemContext !== undefined ? { ephemeralSystemContext } : {}),
        getSession: () => this.callbacks.getSessionOrThrow(),
        getCwd: () => this.callbacks.getCwd(),
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
          this.callbacks.emit('complete', result);
        },
        onInterrupted: (result: IExecutionResult) => {
          this.callbacks.emit('interrupted', result);
        },
        onError: (err: Error) => {
          this.callbacks.emit('error', err);
        },
        onContextUpdate: () => {
          this.callbacks.emit('context_update', this.callbacks.getContextState());
        },
      });
    } finally {
      try {
        await this.histTracker.finalizeEditCheckpointTurn();
      } catch (error) {
        this.callbacks.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
      this.executing = false;
      this.activeDriverId = null; // REMOTE-014 E5: turn ended — events after this are not turn-authored
      this.callbacks.emit('thinking', false);
      // FLOW-002: the wake for this task id is no longer in flight; allow future wakes to inject.
      if (turnOptions.wakeTaskId !== undefined) this.wakeTaskIds.delete(turnOptions.wakeTaskId);
      this.emitExecutionWorkspaceUpdated('main_thread');
      // SELFHOST-008 P2: post-turn auto-capture — completed USER-turn path only (agent-wakeup/goal turns
      // carry agent-authored text, not user facts, so they are skipped), AWAITED here (this `finally` is an
      // awaited scope) so recorded events land in the SAME turn's persisted record, and guarded so a capture
      // bug never breaks the turn. Runs BEFORE persistSession().
      if (
        this.callbacks.captureMemory &&
        completedResult &&
        (turnOptions.turnSource ?? 'user') === 'user'
      ) {
        try {
          const events = await this.callbacks.captureMemory({
            userMessage: displayInput ?? input,
            assistantMessage: completedResult.response,
          });
          for (const event of events) this.histTracker.recordMemoryEvent(event);
        } catch (error) {
          // allow-fallback: memory capture is best-effort — a capture failure must never fail the turn
          this.callbacks.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.callbacks.persistSession();
      this.drainPendingQueue(submit);
    }
  }

  async executeForkSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    qualifiedName: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
    submit: (p: string, d?: string, r?: string) => Promise<void>,
  ): Promise<ISkillExecutionResult> {
    if (this.executing) {
      throw new Error('Cannot execute fork skill while another prompt is running.');
    }
    this.executing = true;
    this.clearStreaming();
    this.callbacks.emit('thinking', true);
    this.histTracker.append(
      messageToHistoryEntry(createUserMessage(displayInput ?? `/${skill.name}`)),
    );
    this.emitExecutionWorkspaceUpdated('main_thread');

    try {
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
      this.executing = false;
      this.callbacks.emit('thinking', false);
      this.emitExecutionWorkspaceUpdated('main_thread');
      this.callbacks.persistSession();
      this.drainPendingQueue(submit);
    }
  }

  async executeForegroundCommand(
    execute: () => Promise<ICommandResult>,
    submit: (p: string, d?: string, r?: string) => Promise<void>,
  ): Promise<ICommandResult> {
    this.executing = true;
    this.clearStreaming();
    this.callbacks.emit('thinking', true);
    this.emitExecutionWorkspaceUpdated('main_thread');
    try {
      const result = await execute();
      this.callbacks.emit('context_update', this.callbacks.getContextState());
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Error: ${errMsg}` };
    } finally {
      this.executing = false;
      this.callbacks.emit('thinking', false);
      this.emitExecutionWorkspaceUpdated('main_thread');
      this.callbacks.persistSession();
      this.drainPendingQueue(submit);
    }
  }

  async applyForkSkillResult(result: string): Promise<void> {
    this.flushStreaming();
    pushToolSummaryToHistory({
      activeTools: this.activeTools,
      history: this.histTracker.getHistory(),
    });
    this.clearStreaming();
    const executionResult = {
      response: result,
      history: this.histTracker.getHistory(),
      toolSummaries: [],
      contextState: this.callbacks.getContextState(),
    };
    this.histTracker.append(messageToHistoryEntry(createAssistantMessage(result)));
    this.callbacks.emit('complete', executionResult);
    this.callbacks.emit('context_update', this.callbacks.getContextState());
  }
}
