import type { IBackgroundTaskViewModel } from './tui-state-manager.js';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SUCCESS_EXIT_CODE = 0;

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
  now?: number;
  isLast?: boolean;
}

export function formatBackgroundTaskRow(
  task: IBackgroundTaskViewModel,
  options: IBackgroundTaskRowOptions = {},
): IBackgroundTaskRow {
  const row = {
    connector: options.isLast === false ? '├' : '└',
    marker: getStatusMarker(task),
    color: getStatusColor(task),
    label: getTaskLabel(task),
    segments: getTaskSegments(task, options.now ?? Date.now()),
    preview: getTaskPreview(task),
  } satisfies Omit<IBackgroundTaskRow, 'accessibleText'>;

  return {
    ...row,
    accessibleText: formatAccessibleText(row),
  };
}

function getStatusColor(task: IBackgroundTaskViewModel): string {
  if (isFailedTask(task)) return 'red';
  if (task.status === 'completed') return 'green';
  if (task.status === 'cancelled') return 'yellow';
  return 'cyan';
}

function getStatusMarker(task: IBackgroundTaskViewModel): '□' | '■' {
  if (task.status === 'queued' || task.status === 'running') return '□';
  return '■';
}

function getTaskLabel(task: IBackgroundTaskViewModel): string {
  if (task.kind === 'agent') return `${task.label} agent`;
  if (task.kind === 'process') return task.label || 'Process';
  return task.label;
}

function getTaskSegments(task: IBackgroundTaskViewModel, now: number): string[] {
  const segments: string[] = [];
  if (task.status === 'running') {
    const idle = formatAge(task.lastActivityAt, now);
    if (idle) segments.push(`idle ${idle}`);
  }
  if (task.status === 'failed') {
    segments.push(task.statusLabel === 'timed out' ? 'timed out' : 'failed');
  }
  if (task.status === 'cancelled') {
    segments.push('cancelled');
  }
  if (task.timeoutReason) {
    segments.push(task.timeoutReason);
  }
  if (
    task.status === 'completed' &&
    task.exitCode !== undefined &&
    task.exitCode !== SUCCESS_EXIT_CODE
  ) {
    segments.push(`exit ${task.exitCode}`);
  }
  if (task.signalCode) {
    segments.push(`signal ${task.signalCode}`);
  }
  if (task.worktreePath || task.branchName) {
    segments.push('worktree');
  }
  return segments;
}

function getTaskPreview(task: IBackgroundTaskViewModel): string | undefined {
  if (task.worktreeNextAction) return task.worktreeNextAction;
  if (task.worktreePath) return task.worktreePath;
  const preview = task.errorPreview ?? task.resultPreview ?? task.currentAction ?? task.preview;
  return preview || undefined;
}

function formatAge(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return undefined;
  const seconds = Math.max(0, Math.floor((now - timestamp) / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}h`;
}

function isFailedTask(task: IBackgroundTaskViewModel): boolean {
  return (
    task.status === 'failed' ||
    (task.status === 'completed' &&
      ((task.exitCode !== undefined && task.exitCode !== SUCCESS_EXIT_CODE) || !!task.signalCode))
  );
}

function formatAccessibleText(row: Omit<IBackgroundTaskRow, 'accessibleText'>): string {
  const parts = [`${row.connector} ${row.marker} ${row.label}`, ...row.segments];
  if (row.preview) parts.push(row.preview);
  return parts.join(' · ');
}
