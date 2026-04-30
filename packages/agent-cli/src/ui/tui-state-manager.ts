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
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-sdk';

/** Max messages kept in rendering state */
const MAX_RENDERED_MESSAGES = 100;

/** Debounce interval for streaming text notify (limits renderMarkdown frequency) */
const STREAMING_DEBOUNCE_MS = 300;
const BACKGROUND_PREVIEW_LENGTH = 120;

export interface IContextState {
  percentage: number;
  usedTokens: number;
  maxTokens: number;
}

export interface IBackgroundTaskViewModel {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  currentAction?: string;
  unread: boolean;
  preview: string;
  resultPreview?: string;
  errorPreview?: string;
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
      this.backgroundTasks = this.backgroundTasks.filter((task) => task.id !== event.taskId);
      this.notify();
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

  private upsertBackgroundTask(state: IBackgroundTaskState): void {
    const viewModel = toBackgroundTaskViewModel(state);
    const index = this.backgroundTasks.findIndex((task) => task.id === state.id);
    if (index === -1) {
      this.backgroundTasks = [...this.backgroundTasks, viewModel];
    } else {
      const updated = [...this.backgroundTasks];
      updated[index] = viewModel;
      this.backgroundTasks = updated;
    }
    this.notify();
  }

  private updateBackgroundTaskAction(taskId: string, currentAction?: string): void {
    this.backgroundTasks = this.backgroundTasks.map((task) =>
      task.id === taskId ? { ...task, currentAction } : task,
    );
    this.notify();
  }
}

function trimBackgroundPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > BACKGROUND_PREVIEW_LENGTH
    ? `${value.slice(0, BACKGROUND_PREVIEW_LENGTH)}...`
    : value;
}

function toBackgroundTaskViewModel(state: IBackgroundTaskState): IBackgroundTaskViewModel {
  return {
    id: state.id,
    kind: state.kind,
    label: state.label,
    status: state.status,
    mode: state.mode,
    currentAction: state.currentAction,
    unread: state.unread,
    preview: trimBackgroundPreview(state.promptPreview ?? state.commandPreview) ?? '',
    resultPreview: trimBackgroundPreview(state.result?.output),
    errorPreview: trimBackgroundPreview(state.error?.message),
  };
}
