/**
 * TuiStateManager — pure TypeScript rendering state manager.
 *
 * Converts InteractiveSession events into rendering state.
 * No React dependency. Fully unit-testable.
 *
 * React hook (useInteractiveSession) subscribes to onChange
 * and reads state for rendering.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IToolState,
  IExecutionResult,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';
import {
  shouldHideAtNextUserTurn,
  toBackgroundTaskViewModel,
  trimBackgroundPreview,
  type IBackgroundTaskViewModel,
} from './background-task-view-model.js';

export type { IBackgroundTaskViewModel } from './background-task-view-model.js';

/** Max messages kept in rendering state */
const MAX_RENDERED_MESSAGES = 100;

/** Debounce interval for streaming text notify (limits renderMarkdown frequency) */
const STREAMING_DEBOUNCE_MS = 300;
export interface IContextState {
  percentage: number;
  usedTokens: number;
  maxTokens: number;
}

/** Create a debounced notify — schedules at most one call per interval. */
function createDebouncedNotify(
  notify: () => void,
  ms: number,
): { schedule: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          notify();
        }, ms);
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export class TuiStateManager {
  // ── Rendering state ───────────────────────────────────────────
  history: IHistoryEntry[] = [];
  streamingText = '';
  activeTools: IToolState[] = [];
  isThinking = false;
  isAborting = false;
  pendingPrompt: string | null = null;
  contextState: IContextState = { percentage: 0, usedTokens: 0, maxTokens: 0 };
  backgroundTasks: IBackgroundTaskViewModel[] = [];

  /** Called after any state change. React hook sets this to trigger re-render. */
  onChange: (() => void) | null = null;

  // ── Internal ──────────────────────────────────────────────────
  private streamBuf = '';
  private backgroundTextBuffers = new Map<string, string>();
  private backgroundTasksHiddenOnNextTurn = new Set<string>();
  private debouncedStreamNotify = createDebouncedNotify(() => this.notify(), STREAMING_DEBOUNCE_MS);

  private notify(): void {
    this.onChange?.();
  }

  // ── Event handlers (InteractiveSession → state) ───────────────

  onTextDelta = (delta: string): void => {
    this.streamBuf += delta;
    this.streamingText = this.streamBuf;
    this.debouncedStreamNotify.schedule();
  };

  onToolStart = (state: IToolState): void => {
    this.activeTools = [...this.activeTools, state];
    this.notify();
  };

  onToolEnd = (state: IToolState): void => {
    const idx = this.activeTools.findIndex((t) => t.toolName === state.toolName && t.isRunning);
    if (idx !== -1) {
      const updated = [...this.activeTools];
      updated[idx] = state;
      this.activeTools = updated;
    }
    this.notify();
  };

  onThinking = (thinking: boolean): void => {
    this.isThinking = thinking;
    if (thinking) {
      // Clear at START of new execution (preserves previous result until next)
      this.debouncedStreamNotify.flush();
      this.streamBuf = '';
      this.streamingText = '';
      this.activeTools = [];
    } else {
      this.isAborting = false;
    }
    this.notify();
  };

  onComplete = (result: IExecutionResult): void => {
    // Tool summary is now in messages (pushed by InteractiveSession)
    // Clear streaming display
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
    this.contextState = {
      percentage: result.contextState.usedPercentage,
      usedTokens: result.contextState.usedTokens,
      maxTokens: result.contextState.maxTokens,
    };
    this.notify();
  };

  onInterrupted = (): void => {
    // Tool summary is now in messages
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
    this.notify();
  };

  onError = (): void => {
    // Tool summary is now in messages
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
    this.notify();
  };

  onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void => {
    if ('task' in event) {
      this.upsertBackgroundTask(event.task);
      return;
    }

    if (event.type === 'background_task_closed') {
      this.backgroundTextBuffers.delete(event.taskId);
      this.backgroundTasksHiddenOnNextTurn.delete(event.taskId);
      this.backgroundTasks = this.backgroundTasks.filter((task) => task.id !== event.taskId);
      this.notify();
      return;
    }

    if (event.type === 'background_task_text_delta') {
      this.appendBackgroundTaskText(event.taskId, event.delta);
      return;
    }

    if (event.type === 'background_task_tool_start') {
      this.updateBackgroundTaskAction(event.taskId, event.firstArg ?? event.toolName);
      return;
    }

    if (event.type === 'background_task_tool_end') {
      this.updateBackgroundTaskAction(event.taskId, event.success ? undefined : event.error);
    }
  };

  // ── State updates from external sources ───────────────────────

  /** Sync history from InteractiveSession */
  syncHistory(entries: IHistoryEntry[]): void {
    if (entries.length === 0) return;
    this.history =
      entries.length > MAX_RENDERED_MESSAGES ? entries.slice(-MAX_RENDERED_MESSAGES) : [...entries];
    this.notify();
  }

  /** Add a single history entry */
  addEntry(entry: IHistoryEntry): void {
    const updated = [...this.history, entry];
    this.history =
      updated.length > MAX_RENDERED_MESSAGES ? updated.slice(-MAX_RENDERED_MESSAGES) : updated;
    this.notify();
  }

  /** Update pending prompt state */
  setPendingPrompt(prompt: string | null): void {
    this.pendingPrompt = prompt;
    this.notify();
  }

  /** Set aborting flag */
  setAborting(aborting: boolean): void {
    this.isAborting = aborting;
    this.notify();
  }

  /** Update context state */
  setContextState(state: IContextState): void {
    this.contextState = state;
    this.notify();
  }

  onUserTurnAccepted(): void {
    if (this.backgroundTasksHiddenOnNextTurn.size === 0) return;
    const visible = this.backgroundTasks.filter(
      (task) => !this.backgroundTasksHiddenOnNextTurn.has(task.id),
    );
    this.backgroundTasksHiddenOnNextTurn.clear();
    if (visible.length === this.backgroundTasks.length) return;
    this.backgroundTasks = visible;
    this.notify();
  }

  private upsertBackgroundTask(state: IBackgroundTaskState): void {
    const partialText = state.result ? undefined : this.backgroundTextBuffers.get(state.id);
    const viewModel = toBackgroundTaskViewModel(state, partialText);
    const index = this.backgroundTasks.findIndex((task) => task.id === state.id);
    if (index === -1) {
      this.backgroundTasks = [...this.backgroundTasks, viewModel];
    } else {
      const updated = [...this.backgroundTasks];
      updated[index] = viewModel;
      this.backgroundTasks = updated;
    }
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      this.backgroundTextBuffers.delete(state.id);
    }
    if (shouldHideAtNextUserTurn(state)) {
      this.backgroundTasksHiddenOnNextTurn.add(state.id);
    } else {
      this.backgroundTasksHiddenOnNextTurn.delete(state.id);
    }
    this.notify();
  }

  private appendBackgroundTaskText(taskId: string, delta: string): void {
    const nextText = `${this.backgroundTextBuffers.get(taskId) ?? ''}${delta}`;
    this.backgroundTextBuffers.set(taskId, nextText);
    this.backgroundTasks = this.backgroundTasks.map((task) =>
      task.id === taskId ? { ...task, resultPreview: trimBackgroundPreview(nextText) } : task,
    );
    this.notify();
  }

  private updateBackgroundTaskAction(taskId: string, currentAction?: string): void {
    this.backgroundTasks = this.backgroundTasks.map((task) =>
      task.id === taskId ? { ...task, currentAction } : task,
    );
    this.notify();
  }
}
