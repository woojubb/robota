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
import type { IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import type { TTurnSource } from '@robota-sdk/agent-interface-transport';
import type { ICompactEvent } from '@robota-sdk/agent-session';
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
}

/** Options threaded through submit/executePrompt for non-user turns (FLOW-002). */
export interface ITurnOptions {
  turnSource?: TTurnSource;
  /** When set, the in-flight wake for this background task id is cleared on turn completion. */
  wakeTaskId?: string;
}

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
  pendingPrompt: string | null = null;
  pendingDisplayInput: string | undefined;
  pendingRawInput: string | undefined;
  pendingTurnOptions: ITurnOptions = {};
  shuttingDown = false;

  /** FLOW-002: background task ids with an in-flight wake turn (coalesces duplicate wakes). */
  readonly wakeTaskIds = new Set<string>();

  constructor(
    private readonly histTracker: SessionHistoryTracker,
    private readonly skillRouter: SessionSkillRouter,
    private readonly callbacks: IExecutionControllerCallbacks,
  ) {}

  clearPendingQueue(): void {
    this.pendingPrompt = null;
    this.pendingDisplayInput = undefined;
    this.pendingRawInput = undefined;
    this.pendingTurnOptions = {};
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
    if (!this.shuttingDown && this.pendingPrompt) {
      const queued = this.pendingPrompt;
      const queuedDisplay = this.pendingDisplayInput;
      const queuedRaw = this.pendingRawInput;
      const queuedOptions = this.pendingTurnOptions;
      this.clearPendingQueue();
      setTimeout(() => void submit(queued, queuedDisplay, queuedRaw, queuedOptions), 0);
    }
  }

  async executePrompt(
    input: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    agentsFileEntries: IContextFileEntry[],
    claudeFileEntries: IContextFileEntry[],
    rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null,
    setEntries: (agents: IContextFileEntry[], claude: IContextFileEntry[]) => void,
    submit: TSubmitFn,
    turnOptions: ITurnOptions = {},
  ): Promise<void> {
    await checkAndRefreshContextIfStale(
      agentsFileEntries,
      claudeFileEntries,
      rebuildSystemMessage,
      setEntries,
      () => this.callbacks.getSessionOrThrow(),
      (event: string, payload: unknown) => this.callbacks.emit(event, payload),
    );
    this.executing = true;
    this.clearStreaming();
    // FLOW-002: surface the turn origin so consumers (hooks, TUI) can distinguish a human
    // prompt from an agent-wakeup re-entry.
    this.callbacks.emit('turn_source', turnOptions.turnSource ?? 'user');
    this.callbacks.emit('user_message', displayInput ?? input);
    this.callbacks.emit('thinking', true);
    try {
      await executePromptTurn(input, displayInput, rawInput, {
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
        onWorkspaceUpdated: () => this.emitExecutionWorkspaceUpdated('main_thread'),
        onComplete: (result: IExecutionResult) => {
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
      this.callbacks.emit('thinking', false);
      // FLOW-002: the wake for this task id is no longer in flight; allow future wakes to inject.
      if (turnOptions.wakeTaskId !== undefined) this.wakeTaskIds.delete(turnOptions.wakeTaskId);
      this.emitExecutionWorkspaceUpdated('main_thread');
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
