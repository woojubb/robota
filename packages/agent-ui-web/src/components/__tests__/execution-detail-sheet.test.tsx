// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionDetailSheet } from '../ExecutionDetailSheet.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/**
 * Opening an Agents panel entry shows what it was asked, its transcript (paged) and its
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
        entry={createEntry({
          status: 'completed',
          attention: 'completed',
          controls: ['select', 'close'],
        })}
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

describe('fork follow', () => {
  it('sends a follow-up to the running fork without switching the parent', () => {
    const onSend = vi.fn();
    const onContinue = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry({
          resumeSessionId: 'fork-session',
          controls: ['select', 'attach', 'send'],
        })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSend={onSend}
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message the fork' }), {
      target: { value: 'Check the result' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to fork' }));
    expect(onSend).toHaveBeenCalledWith('Check the result');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('offers continuing an ended fork and never offers send', () => {
    const onContinue = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry({
          resumeSessionId: 'fork-session',
          status: 'completed',
          state: 'completed',
          controls: ['select', 'attach'],
        })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        onSend={vi.fn()}
        onContinue={onContinue}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'Message the fork' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue as session' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('fork transcript', () => {
  it('explains unreadable records and requests earlier output only when selected', () => {
    const earlier = vi.fn();
    render(
      <ExecutionDetailSheet
        entry={createEntry({ resumeSessionId: 'fork-session', controls: ['select', 'attach'] })}
        status="ready"
        records={[]}
        error={null}
        complete
        onClose={vi.fn()}
        onLoadMore={vi.fn()}
        mode="live"
        unreadable={{ locked: 1, noKeys: 2, doesNotOpen: 3 }}
        onShowEarlier={earlier}
        onShowLive={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 locked, 2 without keys, 3 unavailable/)).toBeTruthy();
    expect(earlier).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier output' }));
    expect(earlier).toHaveBeenCalledTimes(1);
  });
});

it('prevents duplicate sends and clears the draft only after success', () => {
  const onSend = vi.fn();
  const entry = createEntry({
    resumeSessionId: 'fork-session',
    controls: ['select', 'attach', 'send'],
  });
  const props = {
    entry,
    status: 'ready' as const,
    records: [],
    error: null,
    complete: true,
    onClose: vi.fn(),
    onLoadMore: vi.fn(),
    onSend,
  };
  const { rerender } = render(<ExecutionDetailSheet {...props} />);
  const field = screen.getByRole('textbox', { name: 'Message the fork' });
  fireEvent.change(field, { target: { value: 'First message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to fork' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send to fork' }));
  expect(onSend).toHaveBeenCalledTimes(1);
  rerender(
    <ExecutionDetailSheet {...props} inputState={{ taskId: entry.sourceId, status: 'pending' }} />,
  );
  expect((field as HTMLTextAreaElement).value).toBe('First message');
  rerender(
    <ExecutionDetailSheet {...props} inputState={{ taskId: entry.sourceId, status: 'sent' }} />,
  );
  expect((field as HTMLTextAreaElement).value).toBe('');
});

it('preserves the draft when a send fails', () => {
  const entry = createEntry({
    resumeSessionId: 'fork-session',
    controls: ['select', 'attach', 'send'],
  });
  const props = {
    entry,
    status: 'ready' as const,
    records: [],
    error: null,
    complete: true,
    onClose: vi.fn(),
    onLoadMore: vi.fn(),
    onSend: vi.fn(),
  };
  const { rerender } = render(<ExecutionDetailSheet {...props} />);
  const field = screen.getByRole('textbox', { name: 'Message the fork' });
  fireEvent.change(field, { target: { value: 'Retry this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to fork' }));
  rerender(
    <ExecutionDetailSheet {...props} inputState={{ taskId: entry.sourceId, status: 'failed' }} />,
  );
  expect((field as HTMLTextAreaElement).value).toBe('Retry this');
  fireEvent.click(screen.getByRole('button', { name: 'Send to fork' }));
  expect(props.onSend).toHaveBeenCalledTimes(2);
});

it('disables sending to a second fork while the first send is pending', () => {
  const entry = createEntry({
    sourceId: 'second',
    resumeSessionId: 'second-session',
    controls: ['select', 'attach', 'send'],
  });
  const onSend = vi.fn();
  render(
    <ExecutionDetailSheet
      entry={entry}
      status="ready"
      records={[]}
      error={null}
      complete
      onClose={vi.fn()}
      onLoadMore={vi.fn()}
      onSend={onSend}
      inputState={{ taskId: 'first', status: 'pending' }}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Message the fork' }), {
    target: { value: 'Second' },
  });
  expect((screen.getByRole('button', { name: 'Send to fork' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Send to fork' }).closest('form')!);
  expect(onSend).not.toHaveBeenCalled();
});
