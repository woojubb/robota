/**
 * TuiStateManager — pure TypeScript rendering state manager.
 *
 * Converts InteractiveSession events into rendering state.
 * No React dependency. Fully unit-testable.
 *
 * React hook (useTuiChannel) subscribes to onChange
 * and reads state for rendering.
 */

import type { IContextWindowState, IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IExecutionResult,
  IExecutionWorkspaceSnapshot,
  IToolState,
} from '@robota-sdk/agent-interface-transport';

/** Debounce interval for streaming text notify (limits renderMarkdown frequency) */
const STREAMING_DEBOUNCE_MS = 300;
/** ERR-001 G3: with no provider activity for this long while thinking, hint that the
 * connection may be stalled (well under the 120s provider idle timeout). */
const STALL_HINT_MS = 15_000;
/**
 * TUI view of the core context-window state. The token fields are derived from the agent-core
 * SSOT (`IContextWindowState`) via `Pick` so they stay structurally tied to it; `percentage` is an
 * explicit display-facing mirror of `IContextWindowState.usedPercentage`.
 */
export type TContextState = Pick<IContextWindowState, 'usedTokens' | 'maxTokens'> & {
  /** Mirror of `IContextWindowState.usedPercentage`, named for the TUI display layer. */
  percentage: number;
};

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
  contextState: TContextState = { percentage: 0, usedTokens: 0, maxTokens: 0 };
  executionWorkspaceSnapshot: IExecutionWorkspaceSnapshot | null = null;
  selectedExecutionEntryId: string | undefined;
  /** ERR-001 G2: humanized message of the last failed turn; cleared when the next turn starts. */
  lastErrorMessage: string | null = null;
  /** ERR-001 G3: no stream/tool activity for STALL_HINT_MS while thinking. */
  isStalled = false;

  /** Called after any state change. React hook sets this to trigger re-render. */
  onChange: (() => void) | null = null;

  // ── Internal ──────────────────────────────────────────────────
  private streamBuf = '';
  private debouncedStreamNotify = createDebouncedNotify(() => this.notify(), STREAMING_DEBOUNCE_MS);
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  /** (Re)start the dead-air timer — any provider activity proves the connection is alive. */
  private armStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.isStalled = true;
      this.notify();
    }, STALL_HINT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
    if (this.isStalled) {
      this.isStalled = false;
    }
  }

  private notify(): void {
    this.onChange?.();
  }

  // ── Event handlers (InteractiveSession → state) ───────────────

  onTextDelta = (delta: string): void => {
    if (this.isThinking) this.armStallTimer();
    this.streamBuf += delta;
    this.streamingText = this.streamBuf;
    this.debouncedStreamNotify.schedule();
  };

  onToolStart = (state: IToolState): void => {
    if (this.isThinking) this.armStallTimer();
    this.activeTools = [...this.activeTools, state];
    this.notify();
  };

  onToolEnd = (state: IToolState): void => {
    // findLastIndex: when same tool runs concurrently, match the most recently started instance
    const idx = this.activeTools.findLastIndex((t) => t.toolName === state.toolName && t.isRunning);
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
      this.lastErrorMessage = null;
      this.armStallTimer();
    } else {
      this.isAborting = false;
      this.activeTools = [];
      this.clearStallTimer();
    }
    this.notify();
  };

  onComplete = (result: IExecutionResult): void => {
    // Tool summary is now in messages (pushed by InteractiveSession)
    // Clear streaming display
    this.clearStallTimer();
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
    this.clearStallTimer();
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
    this.notify();
  };

  onError = (error?: Error): void => {
    // The partial answer is preserved as an interrupted history entry by the framework
    // (ERR-001); clearing the local stream buffer here no longer loses it.
    this.clearStallTimer();
    this.lastErrorMessage = error?.message ?? 'Unknown error';
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
    this.notify();
  };

  onContextUpdate = (state: IContextWindowState): void => {
    this.setContextState({
      percentage: state.usedPercentage,
      usedTokens: state.usedTokens,
      maxTokens: state.maxTokens,
    });
  };

  // ── State updates from external sources ───────────────────────

  /**
   * Sync history from InteractiveSession — authoritative SSOT replace (SCREEN-010: no front-windowing).
   * The session history grows monotonically during a session, so Ink `<Static>` (count-based) renders
   * only the newly-appended tail; committed lines already in terminal scrollback are never re-printed.
   */
  syncHistory(entries: IHistoryEntry[]): void {
    if (entries.length === 0) return;
    this.history = [...entries];
    this.notify();
  }

  /** Add a single history entry (append; e.g. the immediate user-message echo before the sync). */
  addEntry(entry: IHistoryEntry): void {
    this.history = [...this.history, entry];
    this.notify();
  }

  clearHistory(): void {
    this.history = [];
    this.debouncedStreamNotify.flush();
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
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
  setContextState(state: TContextState): void {
    this.contextState = state;
    this.notify();
  }

  syncExecutionWorkspaceSnapshot(snapshot: IExecutionWorkspaceSnapshot): void {
    const currentSelection = this.selectedExecutionEntryId;
    const hasCurrentSelection =
      currentSelection !== undefined &&
      snapshot.entries.some((entry) => entry.id === currentSelection);
    const selectedExecutionEntryId = hasCurrentSelection
      ? currentSelection
      : (snapshot.selectedEntryId ?? snapshot.entries[0]?.id);
    this.executionWorkspaceSnapshot = {
      ...snapshot,
      ...(selectedExecutionEntryId ? { selectedEntryId: selectedExecutionEntryId } : {}),
    };
    this.selectedExecutionEntryId = selectedExecutionEntryId;
    this.notify();
  }

  selectExecutionWorkspaceEntry(entryId: string): void {
    if (!this.executionWorkspaceSnapshot?.entries.some((entry) => entry.id === entryId)) return;
    this.selectedExecutionEntryId = entryId;
    this.executionWorkspaceSnapshot = {
      ...this.executionWorkspaceSnapshot,
      selectedEntryId: entryId,
    };
    this.notify();
  }
}
