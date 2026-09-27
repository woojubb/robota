// @vitest-environment jsdom
/**
 * #3282 §4c — the Project panel: lists changed files with a plain-word status and +N/-M counts,
 * clicking one shows its diff via `DiffLines`, Refresh re-requests the status, and a non-repository
 * folder shows one plain sentence instead of a file list.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectPanel } from '../ProjectPanel.js';

import type { IWsSessionState } from '../../hooks/useSessionClient.js';

afterEach(cleanup);

function baseState(overrides: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    status: 'connected',
    messages: [],
    activeTools: [],
    streamingText: '',
    isThinking: false,
    executionWorkspace: null,
    sessionName: null,
    ownDriverId: null,
    commandCatalog: null,
    sessionStatus: null,
    sessionListing: null,
    sessionsError: null,
    requestSessions: () => {},
    switchSession: () => {},
    newSession: () => {},
    sessionSidebarOpen: false,
    setSessionSidebarOpen: () => {},
    send: () => {},
    pendingPrompts: [],
    queuedPrompt: null,
    answerPermission: () => {},
    answerAsk: () => {},
    sessionNotices: [],
    dismissSessionNotice: () => {},
    projectStatusState: 'idle',
    projectStatus: null,
    requestProjectStatus: () => {},
    projectDiffState: 'idle',
    projectDiffPath: null,
    projectDiff: null,
    requestProjectDiff: () => {},
    projectMemoryState: 'idle',
    projectMemory: null,
    requestProjectMemory: () => {},
    ...overrides,
  } as unknown as IWsSessionState;
}

describe('ProjectPanel', () => {
  it('requests status and memory on mount', () => {
    const requestProjectStatus = vi.fn();
    const requestProjectMemory = vi.fn();
    render(<ProjectPanel state={baseState({ requestProjectStatus, requestProjectMemory })} />);
    expect(requestProjectStatus).toHaveBeenCalledTimes(1);
    expect(requestProjectMemory).toHaveBeenCalledTimes(1);
  });

  it('lists changed files with a plain-word status and +N/-M counts', () => {
    render(
      <ProjectPanel
        state={baseState({
          projectStatus: {
            kind: 'status',
            branch: 'main',
            unborn: false,
            files: [
              { path: 'src/a.ts', status: 'Modified', added: 3, removed: 1 },
              { path: 'src/new.ts', status: 'Untracked' },
            ],
            truncated: false,
          },
        })}
      />,
    );
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('Modified')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByText('src/new.ts')).toBeTruthy();
    expect(screen.getByText('Untracked')).toBeTruthy();
    expect(screen.getByText('Changes — main')).toBeTruthy();
  });

  it('clicking a file requests and shows its diff', () => {
    const requestProjectDiff = vi.fn();
    const { rerender } = render(
      <ProjectPanel
        state={baseState({
          projectStatus: {
            kind: 'status',
            branch: 'main',
            unborn: false,
            files: [{ path: 'src/a.ts', status: 'Modified', added: 1, removed: 0 }],
            truncated: false,
          },
          requestProjectDiff,
        })}
      />,
    );
    fireEvent.click(screen.getByText('src/a.ts'));
    expect(requestProjectDiff).toHaveBeenCalledExactlyOnceWith('src/a.ts');

    rerender(
      <ProjectPanel
        state={baseState({
          projectStatus: {
            kind: 'status',
            branch: 'main',
            unborn: false,
            files: [{ path: 'src/a.ts', status: 'Modified', added: 1, removed: 0 }],
            truncated: false,
          },
          requestProjectDiff,
          projectDiffPath: 'src/a.ts',
          projectDiffState: 'ready',
          projectDiff: {
            kind: 'diff',
            diffLines: [{ type: 'add', text: 'new line', lineNumber: 1 }],
            truncated: false,
          },
        })}
      />,
    );
    // The row was already expanded by the first click; this rerender only supplies its diff — no
    // second click (a second click here would toggle the (still-open, same-component) row closed).
    // DiffLines prefixes an added line with "+ " (#3288's convention).
    expect(screen.getByText('+ new line')).toBeTruthy();
  });

  it('Refresh re-requests the status', () => {
    const requestProjectStatus = vi.fn();
    render(
      <ProjectPanel
        state={baseState({
          requestProjectStatus,
          projectStatus: { kind: 'status', branch: 'main', unborn: false, files: [], truncated: false },
        })}
      />,
    );
    requestProjectStatus.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(requestProjectStatus).toHaveBeenCalledTimes(1);
  });

  it('shows one plain sentence for a non-repository folder', () => {
    render(<ProjectPanel state={baseState({ projectStatus: { kind: 'not-a-repository' } })} />);
    expect(screen.getByText('This folder is not a git repository.')).toBeTruthy();
  });

  it('shows the memory read-only text, and "Open in editor" only when the host supports it', () => {
    const { rerender } = render(
      <ProjectPanel
        state={baseState({
          projectMemory: { kind: 'memory', content: '# Notes', path: 'MEMORY.md', truncated: false },
        })}
      />,
    );
    expect(screen.getByText('# Notes')).toBeTruthy();
    expect(screen.queryByText('Open in editor')).toBeNull();

    const onOpenMemoryInEditor = vi.fn();
    rerender(
      <ProjectPanel
        state={baseState({
          projectMemory: { kind: 'memory', content: '# Notes', path: 'MEMORY.md', truncated: false },
        })}
        onOpenMemoryInEditor={onOpenMemoryInEditor}
      />,
    );
    fireEvent.click(screen.getByText('Open in editor'));
    expect(onOpenMemoryInEditor).toHaveBeenCalledExactlyOnceWith('MEMORY.md');
  });

  it('shows the plain unavailable message when memory cannot be read', () => {
    render(
      <ProjectPanel
        state={baseState({
          projectMemory: { kind: 'unavailable', message: "Project memory isn't available for this folder." },
        })}
      />,
    );
    expect(screen.getByText("Project memory isn't available for this folder.")).toBeTruthy();
  });
});
