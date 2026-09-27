// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentActivityPanel } from '../AgentActivityPanel.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

/**
 * #3288 §1: the Agents panel — clicking an entry opens it (the main thread instead returns to the
 * conversation, which this desktop layout already shows beside the panel), a running/queued entry
 * offers Stop, and a task's true outcome is labeled instead of a blanket "Done": a clean completion
 * says "Done", a cancelled one says "Stopped", a completed one that still had a tool call refused
 * along the way says "Needs permission" (distinct from "Needs you" — nothing is waiting on the
 * operator right now, the run is already over).
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
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel'],
    state: 'working',
    ...overrides,
  };
}

const mainThread = createEntry({
  id: 'main:session_1',
  sourceId: 'session_1',
  kind: 'main_thread',
  origin: { kind: 'user_prompt', sessionId: 'session_1' },
  status: 'active',
  title: 'Main thread',
  controls: ['select'],
  state: 'working',
});

describe('AgentActivityPanel — open, and true status (#3288 §1)', () => {
  it('opens a background task on click', () => {
    const onSelect = vi.fn();
    const task = createEntry();
    render(<AgentActivityPanel tasks={[mainThread, task]} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Review the auth module'));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(task);
  });

  it('clicking the main thread entry returns to the conversation, never opens a detail sheet', () => {
    const onSelect = vi.fn();
    const onReturnToConversation = vi.fn();
    render(
      <AgentActivityPanel
        tasks={[mainThread, createEntry()]}
        onSelect={onSelect}
        onReturnToConversation={onReturnToConversation}
      />,
    );

    fireEvent.click(screen.getByText('Main thread'));

    expect(onReturnToConversation).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is keyboard-operable (Enter opens the entry)', () => {
    const onSelect = vi.fn();
    const task = createEntry();
    render(<AgentActivityPanel tasks={[task]} onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole('button', { name: /Review the auth module/ }), {
      key: 'Enter',
    });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(task);
  });

  it('offers Stop on a running task, and clicking it does not also open the entry', () => {
    const onSelect = vi.fn();
    const onStop = vi.fn();
    const task = createEntry({ status: 'running', controls: ['select', 'cancel'] });
    render(<AgentActivityPanel tasks={[task]} onSelect={onSelect} onStop={onStop} />);

    fireEvent.click(screen.getByRole('button', { name: /^Stop / }));

    expect(onStop).toHaveBeenCalledExactlyOnceWith(task);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never offers Stop on a task with no cancel control (already terminal)', () => {
    const task = createEntry({ status: 'completed', controls: ['select', 'close'] });
    render(<AgentActivityPanel tasks={[task]} onStop={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^Stop / })).toBeNull();
  });

  it('labels a clean completion "Done"', () => {
    const task = createEntry({ status: 'completed', attention: 'completed', controls: ['select', 'close'] });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('labels a cancelled task "Stopped", not silence', () => {
    const task = createEntry({ status: 'cancelled', controls: ['select', 'close'] });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('labels a completed task with refused tool calls "Needs permission", not "Done"', () => {
    const task = createEntry({
      status: 'completed',
      attention: 'completed',
      controls: ['select', 'close'],
      deniedToolCalls: 2,
    });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Needs permission')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('a completed task with a ZERO/absent denied count still says "Done"', () => {
    const task = createEntry({ status: 'completed', attention: 'completed', controls: ['select', 'close'] });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText('Needs permission')).toBeNull();
  });

  it('keeps the actionable "Needs you" distinct from the retrospective "Needs permission"', () => {
    const task = createEntry({ status: 'waiting_permission', attention: 'permission' });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Needs you')).toBeTruthy();
    expect(screen.queryByText('Needs permission')).toBeNull();
  });

  it('still labels a failed task "Failed"', () => {
    const task = createEntry({ status: 'failed', attention: 'failed', controls: ['select', 'close'] });
    render(<AgentActivityPanel tasks={[task]} />);
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
