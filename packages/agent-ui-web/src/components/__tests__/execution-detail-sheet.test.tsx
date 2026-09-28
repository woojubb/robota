// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionDetailSheet } from '../ExecutionDetailSheet.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/**
 * #3288 §1: opening an Agents panel entry shows what it was asked, its transcript (paged) and its
 * result, closes on Esc or the close button, and offers Stop when the entry is still stoppable.
 */

afterEach(cleanup);

function createEntry(overrides: Partial<IExecutionWorkspaceEntry> = {}): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    origin: { kind: 'tool_call', sessionId: 'session_1' },
    status: 'running',
    title: 'Review the auth module',
    headline: { kind: 'activity', text: 'Reviewing packages/auth/login.ts' },
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel'],
    state: 'working',
    ...overrides,
  };
}

describe('ExecutionDetailSheet', () => {
  it('renders nothing when no entry is given', () => {
    const { container } = render(
      <ExecutionDetailSheet
        entry={null}
        status="idle"
        records={[]}
        error={null}
        complete={false}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows the title, the one-line ask, and the transcript', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="ready"
        records={[
          { id: 'r1', kind: 'message', text: 'Starting review' },
          { id: 'r2', kind: 'tool_activity', text: 'Read login.ts' },
        ]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('Review the auth module')).toBeTruthy();
    expect(screen.getByText('Reviewing packages/auth/login.ts')).toBeTruthy();
    expect(screen.getByText('Starting review')).toBeTruthy();
    expect(screen.getByText('Read login.ts')).toBeTruthy();
  });

  it('shows the result for a completed entry', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry({ status: 'completed', attention: 'completed', controls: ['select', 'close'] })}
        status="ready"
        records={[{ id: 'r1', kind: 'result', text: 'Found 2 issues.' }]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('Found 2 issues.')).toBeTruthy();
  });

  it('closes on the close button', () => {
    const onClose = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={onClose}
        onLoadMore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={onClose}
        onLoadMore={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Load more while the read is incomplete, and it pages', () => {
    const onLoadMore = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="ready"
        records={[{ id: 'r1', kind: 'message', text: 'a' }]}
        error={null}
        complete={false}
        onClose={vi.fn()}
        onLoadMore={onLoadMore}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows no Load more once the read is complete', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="ready"
        records={[{ id: 'r1', kind: 'message', text: 'a' }]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows the error when the read failed', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry()}
        status="error"
        records={[]}
        error="entry not found"
        complete={false}
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('entry not found')).toBeTruthy();
  });

  it('offers Stop for a stoppable entry, and wires it', () => {
    const onStop = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry({ status: 'running', controls: ['select', 'cancel'] })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Stop / }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('offers no Stop for an entry with no cancel control', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry({ status: 'completed', controls: ['select', 'close'] })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Stop / })).toBeNull();
  });

  it('shows the true status label ("Needs permission"), not a blanket "Done"', () => {
    render(
      <ExecutionDetailSheet
        entry={createEntry({
          status: 'completed',
          attention: 'completed',
          controls: ['select', 'close'],
          deniedToolCalls: 3,
        })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('Needs permission')).toBeTruthy();
    expect(screen.getByText(/3/)).toBeTruthy();
  });
});
