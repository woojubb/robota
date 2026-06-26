import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';
import { STATUS_GLYPH, workspaceStatusKind } from './status-glyph.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-transport';

export interface IBackgroundTaskRow {
  connector: '├' | '└';
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
  return {
    connector: options.isLast === false ? '├' : '└',
    marker,
    color: row.color,
    label: row.title,
    segments,
    preview: row.preview,
    accessibleText: [
      `${options.isLast === false ? '├' : '└'} ${marker} ${row.title}`,
      ...segments,
      row.preview,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · '),
  };
}
