import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';
import { STATUS_GLYPH, workspaceStatusKind } from './status-glyph.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/**
 * The row's leading connector. CLI-2004 adds the plain form: `├`/`└` draw a tree a sighted reader
 * follows at a glance and a screen reader announces as two more characters per row.
 */
export const BACKGROUND_TASK_CONNECTORS = { branch: '├', last: '└', plain: '-' } as const;

export type TBackgroundTaskConnector =
  (typeof BACKGROUND_TASK_CONNECTORS)[keyof typeof BACKGROUND_TASK_CONNECTORS];

export interface IBackgroundTaskRow {
  connector: TBackgroundTaskConnector;
  /** Shared status glyph (⟳ running, ✓ done, ✗ failed, …) — see status-glyph.ts. */
  marker: string;
  color: string;
  label: string;
  segments: string[];
  preview?: string;
  accessibleText: string;
}

export interface IBackgroundTaskRowOptions {
  isLast?: boolean;
  /** Screen-reader mode ⇒ the plain connector. */
  screenReader?: boolean;
}

function resolveConnector(options: IBackgroundTaskRowOptions): TBackgroundTaskConnector {
  if (options.screenReader === true) return BACKGROUND_TASK_CONNECTORS.plain;
  return options.isLast === false
    ? BACKGROUND_TASK_CONNECTORS.branch
    : BACKGROUND_TASK_CONNECTORS.last;
}

export function formatBackgroundTaskRow(
  entry: IExecutionWorkspaceEntry,
  options: IBackgroundTaskRowOptions = {},
): IBackgroundTaskRow {
  const row = formatExecutionWorkspaceEntryRow(entry);
  // Symbol from the same (status, attention) classification that drives row.color,
  // so the marker's glyph and colour always agree (SCREEN-007).
  const marker = STATUS_GLYPH[workspaceStatusKind(entry.status, entry.attention)].symbol;
  const segments = [row.statusLabel, row.subtitle].filter(
    (segment): segment is string => typeof segment === 'string' && segment.length > 0,
  );
  const connector = resolveConnector(options);
  return {
    connector,
    marker,
    color: row.color,
    label: row.title,
    segments,
    preview: row.preview,
    accessibleText: [`${connector} ${marker} ${row.title}`, ...segments, row.preview]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · '),
  };
}
