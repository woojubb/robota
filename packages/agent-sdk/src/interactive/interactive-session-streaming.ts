/**
 * Streaming and tool-event helpers for InteractiveSession.
 *
 * Pure functions that process streaming text deltas and tool execution events,
 * updating state passed in by reference. No class dependency.
 */

import { randomUUID } from 'node:crypto';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IToolState } from './types.js';

/** Max chars to display from first tool argument. */
export const TOOL_ARG_DISPLAY_MAX = 80;
const TAIL_KEEP = 30;
/** Max completed tools to keep in the activeTools array during a single response. */
export const MAX_COMPLETED_TOOLS = 50;
/** Streaming text flush interval (ms) — ~60fps. */
export const STREAMING_FLUSH_INTERVAL_MS = 16;

/** Extract a short display string from the first tool argument. */
export function extractFirstArg(toolArgs?: Record<string, unknown>): string {
  if (!toolArgs) return '';
  const firstVal = Object.values(toolArgs)[0];
  const raw = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? '');
  return raw.length > TOOL_ARG_DISPLAY_MAX
    ? raw.slice(0, TOOL_ARG_DISPLAY_MAX - TAIL_KEEP - 3) + '...' + raw.slice(-TAIL_KEEP)
    : raw;
}

/** Mutable streaming state passed between helpers. */
export interface IStreamingState {
  activeTools: IToolState[];
  history: IHistoryEntry[];
}

/** Build a tool-summary history entry from current active tools and push it into history. */
export function pushToolSummaryToHistory(state: IStreamingState): void {
  if (state.activeTools.length === 0) return;
  const summary = state.activeTools
    .map((t) => {
      const status = t.isRunning
        ? '⟳'
        : t.result === 'success'
          ? '✓'
          : t.result === 'error'
            ? '✗'
            : '⊘';
      return `${status} ${t.toolName}${t.firstArg ? `(${t.firstArg})` : ''}`;
    })
    .join('\n');

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-summary',
    data: {
      tools: state.activeTools.map((t) => ({
        toolName: t.toolName,
        firstArg: t.firstArg,
        isRunning: t.isRunning,
        result: t.result,
      })),
      summary,
    },
  });
}

/** Trim oldest completed tools from the activeTools array if over the limit. */
export function trimCompletedTools(activeTools: IToolState[]): IToolState[] {
  const completed = activeTools.filter((t) => !t.isRunning);
  if (completed.length <= MAX_COMPLETED_TOOLS) return activeTools;

  const excess = completed.length - MAX_COMPLETED_TOOLS;
  let removed = 0;
  return activeTools.filter((t) => {
    if (!t.isRunning && removed < excess) {
      removed++;
      return false;
    }
    return true;
  });
}

/** Process a tool-start event: add to activeTools and push to history. */
export function applyToolStart(
  state: IStreamingState,
  event: { toolName: string; toolArgs?: Record<string, unknown> },
): IToolState {
  const firstArg = extractFirstArg(event.toolArgs);
  const toolState: IToolState = { toolName: event.toolName, firstArg, isRunning: true };
  state.activeTools.push(toolState);

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-start',
    data: { toolName: event.toolName, firstArg, isRunning: true },
  });

  return toolState;
}

/** Process a tool-end event: mark the tool finished and push to history. Returns updated tool or null. */
export function applyToolEnd(
  state: IStreamingState,
  event: {
    toolName: string;
    success?: boolean;
    denied?: boolean;
  },
): IToolState | null {
  const result: IToolState['result'] = event.denied
    ? 'denied'
    : event.success === false
      ? 'error'
      : 'success';

  const idx = state.activeTools.findIndex((t) => t.toolName === event.toolName && t.isRunning);
  if (idx === -1) return null;

  const finished: IToolState = { ...state.activeTools[idx]!, isRunning: false, result };
  state.activeTools[idx] = finished;
  state.activeTools = trimCompletedTools(state.activeTools);

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-end',
    data: {
      toolName: finished.toolName,
      firstArg: finished.firstArg,
      isRunning: false,
      result,
    },
  });

  return finished;
}
