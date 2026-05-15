/**
 * SessionExecutionController — owns execution lifecycle state and methods
 * for InteractiveSession.
 *
 * Manages: executing flag, streaming text, active tools, pending queue,
 * shutting-down flag, and all private execution lifecycle methods.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { ICompactEvent } from '@robota-sdk/agent-sessions';
import type { IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import type { ICommand, ICommandResult, ISkillExecutionResult } from '../commands/index.js';
import type { TExecutionWorkspaceUpdateCause } from '../background-tasks/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import { checkAndRefreshContextIfStale } from './interactive-session-context-refresh.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import {
  STREAMING_FLUSH_INTERVAL_MS,
  pushToolSummaryToHistory,
  applyToolStart,
  applyToolEnd,
} from './interactive-session-streaming.js';
import { executePromptTurn } from './interactive-session-prompt.js';
import type { IToolState } from './types.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { SessionSkillRouter } from './interactive-session-skill-router.js';
import type { IExecutionResult } from './types.js';

export interface IExecutionControllerCallbacks {
  getSession: () => Session;
  getSessionOrThrow: () => Session;
  getCwd: () => string;
  getContextState: () => IContextWindowState;
  getExecutionWorkspaceSnapshot: () => import('../background-tasks/index.js').IExecutionWorkspaceSnapshot;
  emit: <E extends string>(event: E, ...args: unknown[]) => void;
  persistSession: () => void;
}
export class SessionExecutionController {
  executing = false;
  streamingText = '';
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  activeTools: IToolState[] = [];
  pendingPrompt: string | null = null;
  pendingDisplayInput: string | undefined;
  pendingRawInput: string | undefined;
  shuttingDown = false;

  constructor(
    private readonly histTracker: SessionHistoryTracker,
    private readonly skillRouter: SessionSkillRouter,
    private readonly callbacks: IExecutionControllerCallbacks,
  ) {}

  clearPendingQueue(): void {
    this.pendingPrompt = null;
    this.pendingDisplayInput = undefined;
    this.pendingRawInput = undefined;
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

  private drainPendingQueue(submit: (p: string, d?: string, r?: string) => Promise<void>): void {
    if (!this.shuttingDown && this.pendingPrompt) {
      const queued = this.pendingPrompt;
      const queuedDisplay = this.pendingDisplayInput;
      const queuedRaw = this.pendingRawInput;
      this.clearPendingQueue();
      setTimeout(() => void submit(queued, queuedDisplay, queuedRaw), 0);
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
    submit: (p: string, d?: string, r?: string) => Promise<void>,
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
    this.callbacks.emit('user_message', displayInput ?? input);
    this.callbacks.emit('thinking', true);
    try {
      await executePromptTurn(input, displayInput, rawInput, {
        getSession: () => this.callbacks.getSessionOrThrow(),
        getCwd: () => this.callbacks.getCwd(),
        getHistory: () => this.histTracker.getHistory(),
        getContextReferences: () => this.histTracker.listContextReferences(),
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
      const error = err instanceof Error ? err : new Error(String(err));
      this.histTracker.append(
        messageToHistoryEntry(createSystemMessage(`Error: ${error.message}`)),
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
