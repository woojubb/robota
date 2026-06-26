/**
 * Single source of truth for status symbol + color across the TUI.
 *
 * Before SCREEN-005 the same conceptual status (e.g. "running") was rendered
 * three different ways — icons (⟳/✓/✗) in the streaming indicator, markers
 * (□/■) in the background-task panel, and color-only in the workspace detail
 * pane. This module gives every component one semantic status vocabulary and
 * one glyph map, so a "running" task looks the same everywhere and every status
 * pairs a SYMBOL with a color (never color alone — required for no-color
 * terminals and colorblind users).
 */

import type { IToolState, TExecutionWorkspaceStatus } from '@robota-sdk/agent-interface-transport';

export type TUiStatusKind =
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'waiting'
  | 'cancelled'
  | 'idle';

export interface IStatusGlyph {
  /** Unicode symbol shown alongside (not instead of) the color. */
  readonly symbol: string;
  /** Ink/chalk color name. */
  readonly color: string;
}

/** Canonical status → glyph map. Used by every status-rendering component. */
export const STATUS_GLYPH: Record<TUiStatusKind, IStatusGlyph> = {
  running: { symbol: '⟳', color: 'yellow' },
  success: { symbol: '✓', color: 'green' },
  error: { symbol: '✗', color: 'red' },
  denied: { symbol: '⊘', color: 'yellowBright' },
  waiting: { symbol: '◴', color: 'yellow' },
  cancelled: { symbol: '⊘', color: 'yellow' },
  idle: { symbol: '·', color: 'gray' },
};

/** Map a tool-execution state to a semantic status kind. */
export function toolStateStatusKind(tool: IToolState): TUiStatusKind {
  if (tool.isRunning) return 'running';
  if (tool.result === 'error') return 'error';
  if (tool.result === 'denied') return 'denied';
  return 'success';
}

const ACTIVE_WORKSPACE_STATUSES: readonly TExecutionWorkspaceStatus[] = [
  'active',
  'queued',
  'running',
  'sleeping',
];

/** Map an execution-workspace entry status to a semantic status kind. */
export function workspaceStatusKind(status: TExecutionWorkspaceStatus): TUiStatusKind {
  if (status === 'failed') return 'error';
  if (status === 'waiting_permission') return 'waiting';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (ACTIVE_WORKSPACE_STATUSES.includes(status)) return 'running';
  return 'idle';
}
