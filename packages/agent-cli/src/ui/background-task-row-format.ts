import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-sdk';
import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';

export interface IBackgroundTaskRow {
  connector: '├' | '└';
  marker: '□' | '■';
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
  const marker = isActiveEntry(entry) ? '□' : '■';
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

function isActiveEntry(entry: IExecutionWorkspaceEntry): boolean {
  return (
    entry.status === 'active' ||
    entry.status === 'queued' ||
    entry.status === 'running' ||
    entry.status === 'waiting_permission'
  );
}
