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

import type { IThemeColors } from './theme/index.js';
import type {
  TExecutionAttention,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-interface-execution';
import type { IToolState } from '@robota-sdk/agent-interface-session';

export type TUiStatusKind =
  'running' | 'success' | 'error' | 'denied' | 'waiting' | 'cancelled' | 'idle';

/**
 * Canonical status → SYMBOL map. Used by every status-rendering component.
 *
 * SCREEN-2002 split the colour out: a symbol is the same in every theme, a colour is not, and a
 * module-level constant cannot follow a theme resolved at render time. The symbol stays here (this
 * module remains the SSOT for status kinds and their glyphs); the colour comes from the live theme
 * through {@link statusGlyphColor} or the `useStatusGlyph` hook, so the pairing survives — no caller
 * gets one without the other.
 */
export const STATUS_SYMBOL: Record<TUiStatusKind, string> = {
  running: '⟳',
  success: '✓',
  error: '✗',
  denied: '⊘',
  waiting: '◴',
  cancelled: '⊗',
  idle: '·',
};

/** The live theme's colour for a status kind. Always rendered beside {@link STATUS_SYMBOL}. */
export function statusGlyphColor(colors: IThemeColors, kind: TUiStatusKind): string {
  return colors.status[kind];
}

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

/**
 * Map an execution-workspace entry's status (+ optional attention) to a semantic
 * status kind. `attention` takes precedence so an entry flagged failed/permission
 * classifies correctly even when its raw status hasn't caught up — this mirrors the
 * precedence the workspace color logic uses, so colour + glyph come from one rule.
 */
export function workspaceStatusKind(
  status: TExecutionWorkspaceStatus,
  attention?: TExecutionAttention,
): TUiStatusKind {
  if (attention === 'failed' || status === 'failed') return 'error';
  if (attention === 'permission' || status === 'waiting_permission') return 'waiting';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (ACTIVE_WORKSPACE_STATUSES.includes(status)) return 'running';
  return 'idle';
}
