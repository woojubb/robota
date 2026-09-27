'use client';

import { ChevronRight, ExternalLink, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { DiffLines } from './DiffLines.js';

import type {
  IWsSessionState,
  TProjectDiffRead,
  TProjectMemoryRead,
  TProjectStatusRead,
} from '../hooks/session-client-types.js';

/**
 * #3282 §4c — the Project panel: git status (Changes), one file's diff on click, and project memory as
 * readable text. The owner's design principle 4 (#3277): everything Robota implements is usable from
 * the GUI through organized screens — this is git status/diff and project memory's screen. Checkpoints
 * (rewind) are deliberately absent (see `agent-gui-web/docs/SPEC.md`'s design decisions): edit
 * checkpoints only work on a host that can prove a write stays inside the project
 * (`supportsWorkspaceProjectMutation`, Linux-only by design, not a switched-off setting), so there is
 * nothing safe to show here on macOS or Windows.
 */

type TProjectStatusFile = Extract<TProjectStatusRead, { kind: 'status' }>['files'][number];

const STATUS_TONE: Readonly<Record<TProjectStatusFile['status'], string>> = {
  Added: 'text-accent',
  Modified: 'text-warning',
  Deleted: 'text-destructive',
  Renamed: 'text-muted-foreground',
  Copied: 'text-muted-foreground',
  Untracked: 'text-subtle',
  Conflicted: 'text-destructive',
};

function StatusRow({
  file,
  open,
  onOpen,
}: {
  file: TProjectStatusFile;
  open: boolean;
  onOpen: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
    >
      <ChevronRight
        size={13}
        className={`flex-shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`}
      />
      <span
        className={`w-[76px] flex-shrink-0 text-[12px] font-medium ${STATUS_TONE[file.status]}`}
      >
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate break-all font-mono text-[12.5px] text-foreground" title={file.path}>
        {file.path}
      </span>
      {typeof file.added === 'number' && (
        <span className="flex-shrink-0 font-mono text-[12px] text-accent">+{file.added}</span>
      )}
      {typeof file.removed === 'number' && (
        <span className="flex-shrink-0 font-mono text-[12px] text-destructive">-{file.removed}</span>
      )}
    </button>
  );
}

function ChangesSection({
  status,
  statusState,
  onRefresh,
  openPath,
  onSelectFile,
  diff,
  diffState,
  diffPath,
}: {
  status: TProjectStatusRead | null;
  statusState: IWsSessionState['projectStatusState'];
  onRefresh: () => void;
  openPath: string | null;
  onSelectFile: (path: string) => void;
  diff: TProjectDiffRead | null;
  diffState: IWsSessionState['projectDiffState'];
  diffPath: string | null;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-card px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <p className="flex-1 text-[12px] font-medium text-muted-foreground">
          {status?.kind === 'status' && status.branch ? `Changes — ${status.branch}` : 'Changes'}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={statusState === 'loading'}
          aria-label="Refresh"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-subtle hover:bg-hover hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw size={12} className={statusState === 'loading' ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {statusState === 'loading' && status === null && (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">Reading git status…</p>
      )}
      {statusState === 'error' && (
        <p className="px-1 py-2 text-[13px] text-destructive">Could not read git status.</p>
      )}
      {status?.kind === 'not-a-repository' && (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">This folder is not a git repository.</p>
      )}
      {status?.kind === 'failed' && <p className="px-1 py-2 text-[13px] text-destructive">{status.message}</p>}
      {status?.kind === 'status' && status.files.length === 0 && (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">No changes.</p>
      )}
      {status?.kind === 'status' &&
        status.files.map((file) => (
          <div key={file.path} className="flex flex-col">
            <StatusRow file={file} open={openPath === file.path} onOpen={() => onSelectFile(file.path)} />
            {openPath === file.path && (
              <div className="pl-6">
                {diffState === 'loading' && diffPath === file.path && (
                  <p className="py-1.5 text-[12.5px] text-muted-foreground">Reading diff…</p>
                )}
                {diff && diffPath === file.path && diff.kind === 'diff' && diff.diffLines.length === 0 && (
                  <p className="py-1.5 text-[12.5px] text-muted-foreground">No differences.</p>
                )}
                {diff && diffPath === file.path && diff.kind === 'diff' && diff.diffLines.length > 0 && (
                  <>
                    <DiffLines diffLines={diff.diffLines} />
                    {diff.truncated && (
                      <p className="py-1 text-[12px] text-subtle">The diff was too long and was cut short.</p>
                    )}
                  </>
                )}
                {diff && diffPath === file.path && diff.kind === 'failed' && (
                  <p className="py-1.5 text-[12.5px] text-destructive">{diff.message}</p>
                )}
                {diff && diffPath === file.path && diff.kind === 'outside-workspace' && (
                  <p className="py-1.5 text-[12.5px] text-destructive">
                    That path is outside the workspace.
                  </p>
                )}
                {diff && diffPath === file.path && diff.kind === 'not-a-repository' && (
                  <p className="py-1.5 text-[12.5px] text-muted-foreground">
                    This folder is not a git repository.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      {status?.kind === 'status' && status.truncated && (
        <p className="px-1 pt-1 text-[12px] text-subtle">Showing the first files only — there are more.</p>
      )}
    </div>
  );
}

function MemorySection({
  memory,
  memoryState,
  onOpenInEditor,
}: {
  memory: TProjectMemoryRead | null;
  memoryState: IWsSessionState['projectMemoryState'];
  onOpenInEditor?: (path: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-card px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <p className="flex-1 text-[12px] font-medium text-muted-foreground">Memory</p>
        {memory?.kind === 'memory' && onOpenInEditor && (
          <button
            type="button"
            onClick={() => onOpenInEditor(memory.path)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-subtle hover:bg-hover hover:text-foreground"
          >
            <ExternalLink size={12} />
            Open in editor
          </button>
        )}
      </div>
      {memoryState === 'loading' && memory === null && (
        <p className="px-1 py-1 text-[13px] text-muted-foreground">Reading project memory…</p>
      )}
      {memory?.kind === 'unavailable' && (
        <p className="px-1 py-1 text-[13px] text-muted-foreground">{memory.message}</p>
      )}
      {memory?.kind === 'memory' && (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground">
          {memory.content.length > 0 ? memory.content : '(empty)'}
        </pre>
      )}
    </div>
  );
}

export function ProjectPanel({
  state,
  className,
  onOpenMemoryInEditor,
}: {
  state: IWsSessionState;
  className?: string;
  /** Present only when the host can open a file in an external editor (the desktop app). */
  onOpenMemoryInEditor?: (path: string) => void;
}): React.ReactElement {
  useEffect(() => {
    state.requestProjectStatus();
    state.requestProjectMemory();
  }, [state.requestProjectStatus, state.requestProjectMemory]);

  // Which row is expanded — local, and independent from `projectDiffPath` (what the LAST diff
  // request/response concerns): closing a row never needs a request, and reopening a different one
  // must not show the previous file's diff while its own is still loading.
  const [openPath, setOpenPath] = useState<string | null>(null);

  return (
    <div className={`robota-ui flex flex-col overflow-hidden ${className ?? ''}`}>
      <div className="flex h-12 flex-shrink-0 items-center gap-2 px-4">
        <GitBranch size={15} className="text-subtle" />
        <span className="text-[14px] font-medium text-foreground">Project</span>
        {state.projectStatusState === 'loading' && (
          <LoaderCircle size={13} className="ml-auto animate-spin text-subtle" aria-label="loading" />
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        <ChangesSection
          status={state.projectStatus}
          statusState={state.projectStatusState}
          onRefresh={() => state.requestProjectStatus()}
          openPath={openPath}
          onSelectFile={(path) => {
            if (openPath === path) {
              setOpenPath(null);
              return;
            }
            setOpenPath(path);
            state.requestProjectDiff(path);
          }}
          diff={state.projectDiffPath === openPath ? state.projectDiff : null}
          diffState={state.projectDiffPath === openPath ? state.projectDiffState : 'loading'}
          diffPath={state.projectDiffPath}
        />
        <MemorySection
          memory={state.projectMemory}
          memoryState={state.projectMemoryState}
          onOpenInEditor={onOpenMemoryInEditor}
        />
      </div>
    </div>
  );
}
