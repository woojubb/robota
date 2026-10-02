import { X } from 'lucide-react';
import React from 'react';

import { describeExecutionEntryStatus } from '../execution-entry-status.js';

import type { TExecutionDetailStatus } from '../hooks/use-execution-detail.js';
import type {
  IExecutionDetailRecord,
  IExecutionWorkspaceEntry,
} from '@robota-sdk/agent-interface-execution';

const STATUS_TAG_TONE: Record<string, string> = {
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
  muted: 'bg-subtle/15 text-subtle',
};

const RECORD_KIND_LABEL: Record<IExecutionDetailRecord['kind'], string> = {
  message: '',
  tool_activity: 'Tool',
  process_output: 'Output',
  progress: 'Progress',
  result: 'Result',
  error: 'Error',
  group_summary: 'Summary',
};

/**
 * #3288 §1: opening an Agents panel entry — status, what it was asked (one line, from its
 * headline), its transcript so far (paginated via `onLoadMore`) and, once it has one, its result.
 * `entry === null` renders nothing; the caller owns showing/hiding this over the panel.
 */
export function ExecutionDetailSheet({
  entry,
  status,
  records,
  error,
  complete,
  onClose,
  onLoadMore,
  onStop,
}: {
  entry: IExecutionWorkspaceEntry | null;
  status: TExecutionDetailStatus;
  records: readonly IExecutionDetailRecord[];
  error: string | null;
  complete: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onStop?: () => void;
}): React.ReactElement | null {
  if (!entry) return null;
  const described = describeExecutionEntryStatus(entry);
  const canStop = onStop !== undefined && entry.controls.includes('cancel');
  const askedLine = entry.headline?.text ?? entry.preview;

  return (
    <div
      role="dialog"
      aria-label={entry.title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      className="agent-ui absolute inset-y-0 right-0 z-30 flex w-96 flex-col overflow-hidden border-l border-subtle/20 bg-background shadow-2xl shadow-black/40"
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-subtle/15 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
          {entry.title}
        </span>
        {described && (
          <span
            className={`flex-shrink-0 rounded-md px-1.5 py-px text-[12px] ${STATUS_TAG_TONE[described.tone]}`}
          >
            {described.label}
          </span>
        )}
        {canStop && (
          <button
            type="button"
            aria-label={`Stop ${entry.title}`}
            onClick={onStop}
            className="flex-shrink-0 rounded-md px-1.5 py-px text-[12px] text-subtle hover:bg-destructive/10 hover:text-destructive"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          aria-keyshortcuts="Escape"
          onClick={onClose}
          className="flex-shrink-0 rounded-md p-1 text-subtle hover:bg-card hover:text-foreground"
        >
          <X size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>

      {askedLine && (
        <p className="flex-shrink-0 border-b border-subtle/15 px-4 py-2.5 text-[13px] leading-snug text-muted-foreground">
          {askedLine}
        </p>
      )}
      {entry.deniedToolCalls !== undefined && entry.deniedToolCalls > 0 && (
        <p className="flex-shrink-0 px-4 pt-2 text-[12px] text-warning">
          {entry.deniedToolCalls} tool {entry.deniedToolCalls === 1 ? 'call was' : 'calls were'} refused.
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {records.map((record) => (
          <div key={record.id} className="text-[13px] leading-relaxed text-foreground">
            {RECORD_KIND_LABEL[record.kind] && (
              <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
                {RECORD_KIND_LABEL[record.kind]}
              </span>
            )}
            <span className="whitespace-pre-wrap break-words">{record.text}</span>
          </div>
        ))}
        {status === 'loading' && records.length === 0 && (
          <p className="text-[13px] text-subtle">Loading…</p>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        {!complete && status !== 'loading' && (
          <button
            type="button"
            onClick={onLoadMore}
            className="text-[12px] text-subtle underline hover:text-foreground"
          >
            Load more
          </button>
        )}
        {!complete && status === 'loading' && records.length > 0 && (
          <p className="text-[12px] text-subtle">Loading more…</p>
        )}
      </div>
    </div>
  );
}
