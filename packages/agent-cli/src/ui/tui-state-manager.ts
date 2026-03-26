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
import type { IToolState, IExecutionResult } from '@robota-sdk/agent-sdk';

/** Max messages kept in rendering state */
const MAX_RENDERED_MESSAGES = 100;

/** Debounce interval for streaming text notify (limits renderMarkdown frequency) */
const STREAMING_DEBOUNCE_MS = 100;

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
}
