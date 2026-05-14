import type {
  IExecutionDetailRecord,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-sdk';

const ACTIVE_STATUSES: readonly TExecutionWorkspaceStatus[] = [
  'active',
  'queued',
  'running',
  'waiting_permission',
  'sleeping',
];
const DETAIL_RECORD_TEXT_LIMIT = 160;
const PREVIEW_WHITESPACE = /\s+/g;
const PREVIEW_SEPARATOR = ' ';

export interface IExecutionWorkspaceEntryRow {
  id: string;
  radio: '●' | '○';
  title: string;
  subtitle?: string;
  statusLabel: string;
  preview?: string;
  color: string;
  isSelected: boolean;
  accessibleText: string;
}

export interface IExecutionWorkspaceEntryRowOptions {
  selectedEntryId?: string;
}

export function getDefaultBackgroundWorkspaceEntries(
  snapshot: IExecutionWorkspaceSnapshot | null,
): IExecutionWorkspaceEntry[] {
  return (snapshot?.entries ?? []).filter(
    (entry) => entry.kind === 'background_task' && entry.visibility === 'default',
  );
}

export function countActiveBackgroundWorkspaceEntries(
  snapshot: IExecutionWorkspaceSnapshot | null,
): number {
  return getDefaultBackgroundWorkspaceEntries(snapshot).filter((entry) =>
    ACTIVE_STATUSES.includes(entry.status),
  ).length;
}

export function formatExecutionWorkspaceEntryRow(
  entry: IExecutionWorkspaceEntry,
  options: IExecutionWorkspaceEntryRowOptions = {},
): IExecutionWorkspaceEntryRow {
  const isSelected = entry.id === options.selectedEntryId;
  const row = {
    id: entry.id,
    radio: isSelected ? '●' : '○',
    title: formatEntryTitle(entry),
    subtitle: formatEntrySubtitle(entry),
    statusLabel: formatStatusLabel(entry.status),
    preview: trimPreview(entry.preview ?? entry.currentAction),
    color: getEntryColor(entry),
    isSelected,
  } satisfies Omit<IExecutionWorkspaceEntryRow, 'accessibleText'>;
  return { ...row, accessibleText: formatAccessibleText(row) };
}

export function formatExecutionDetailRecord(record: IExecutionDetailRecord): string {
  const text = record.text.trim().replace(PREVIEW_WHITESPACE, PREVIEW_SEPARATOR);
  if (!text) return record.kind;
  return text.length > DETAIL_RECORD_TEXT_LIMIT
    ? `${text.slice(0, DETAIL_RECORD_TEXT_LIMIT)}...`
    : text;
}

function formatEntryTitle(entry: IExecutionWorkspaceEntry): string {
  if (entry.kind === 'main_thread') return entry.title;
  if (entry.kind === 'background_group') return `${entry.title} group`;
  if (entry.taskKind === 'agent') return `${entry.title} agent`;
  if (entry.taskKind === 'process') return entry.title || 'Process';
  if (entry.taskKind === 'scheduled') return entry.title || 'Scheduled';
  return entry.title;
}

function formatEntrySubtitle(entry: IExecutionWorkspaceEntry): string | undefined {
  if (entry.kind === 'main_thread') return entry.subtitle;
  const parts = [
    entry.taskKind,
    entry.subtitle,
    entry.attention === 'none' ? undefined : entry.attention,
  ];
  return (
    parts
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · ') || undefined
  );
}

function formatStatusLabel(status: TExecutionWorkspaceStatus): string {
  return status.replace(/_/g, ' ');
}

function getEntryColor(entry: IExecutionWorkspaceEntry): string {
  if (entry.attention === 'failed' || entry.status === 'failed') return 'red';
  if (entry.attention === 'permission' || entry.status === 'waiting_permission') return 'yellow';
  if (entry.status === 'completed') return 'green';
  if (entry.status === 'cancelled') return 'yellow';
  if (ACTIVE_STATUSES.includes(entry.status)) return 'cyan';
  return 'white';
}

function trimPreview(value: string | undefined): string | undefined {
  const preview = value?.trim().replace(PREVIEW_WHITESPACE, PREVIEW_SEPARATOR);
  return preview || undefined;
}

function formatAccessibleText(row: Omit<IExecutionWorkspaceEntryRow, 'accessibleText'>): string {
  const parts = [row.radio, row.title, row.statusLabel, row.subtitle, row.preview];
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ');
}
