// @vitest-environment jsdom
/**
 * #3288 §1: the Agents panel — clicking an entry opens it (the main thread instead returns to the
 * conversation, which this desktop layout already shows beside the panel), a running/queued entry
 * offers Stop, and a task's true outcome is labeled instead of a blanket "Done": a clean completion
 * says "Done", a cancelled one says "Stopped", a completed one that still had a tool call refused
 * along the way says "Needs permission" (distinct from "Needs you" — nothing is waiting on the
 * operator right now, the run is already over).
 *
 * #3282 §4 part b-3 — the Agents panel's "Scheduled" group and Goal row: plain times (never an ISO
 * string or a cron expression), Pause/Resume, a confirmed Delete, and Cancel goal.
 */
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentActivityPanel } from '../AgentActivityPanel.js';

import type { IBackgroundTaskState, IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type { IGoalState } from '@robota-sdk/agent-interface-session';

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

function schedule(
  overrides: Partial<IBackgroundTaskState<'scheduled'>> = {},
): IBackgroundTaskState<'scheduled'> {
  return {
    id: 'sched_1',
    kind: 'scheduled',
    label: 'Scheduled: check the build',
    status: 'sleeping',
    mode: 'background',
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/repo',
    updatedAt: '2026-05-01T00:00:00.000Z',
    unread: false,
    schedule: { cronExpression: '0 9 * * 1-5', agentInstruction: 'check the build' },
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

describe('AgentActivityPanel — Scheduled group', () => {
  it('shows nothing when there are no schedules', () => {
    render(<AgentActivityPanel tasks={[]} schedules={[]} />);
    expect(screen.queryByText('Scheduled')).toBeNull();
  });

  it('shows what it runs, a plain next-run time (never an ISO string or a cron expression), and status', () => {
    // Same clock time, one calendar day forward — always exactly "Tomorrow" regardless of the hour
    // the test happens to run at.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    render(
      <AgentActivityPanel
        tasks={[]}
        schedules={[schedule({ nextFireAt: tomorrow.toISOString() })]}
      />,
    );
    expect(screen.getByText('check the build')).toBeTruthy();
    const timing = screen.getByText(/Tomorrow \d/);
    expect(timing.textContent).not.toMatch(/T\d\d:\d\d/); // no ISO timestamp
    expect(timing.textContent).not.toMatch(/[*/]/); // no cron expression
    expect(screen.getByText(/Active/)).toBeTruthy();
  });

  it('a recurring schedule with no pending fire is phrased plainly from its cadence', () => {
    render(<AgentActivityPanel tasks={[]} schedules={[schedule({ nextFireAt: undefined })]} />);
    expect(screen.getByText(/Every weekday at 09:00/)).toBeTruthy();
  });

  it('Pause on an active schedule runs the same path `/schedule pause <id>` runs', () => {
    const onPauseSchedule = vi.fn();
    render(<AgentActivityPanel tasks={[]} schedules={[schedule()]} onPauseSchedule={onPauseSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    expect(onPauseSchedule).toHaveBeenCalledExactlyOnceWith('sched_1');
  });

  it('a paused schedule offers Resume instead of Pause', () => {
    const onResumeSchedule = vi.fn();
    render(
      <AgentActivityPanel
        tasks={[]}
        schedules={[schedule({ status: 'paused' })]}
        onResumeSchedule={onResumeSchedule}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Pause/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    expect(onResumeSchedule).toHaveBeenCalledExactlyOnceWith('sched_1');
  });

  it('Delete is confirmed before it runs', () => {
    const onDeleteSchedule = vi.fn();
    render(<AgentActivityPanel tasks={[]} schedules={[schedule()]} onDeleteSchedule={onDeleteSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    // The write has not happened yet — a confirmation dialog stands between the click and the call.
    expect(onDeleteSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Delete this schedule?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteSchedule).toHaveBeenCalledExactlyOnceWith('sched_1');
  });

  it('cancelling the confirmation never calls the delete write', () => {
    const onDeleteSchedule = vi.fn();
    render(<AgentActivityPanel tasks={[]} schedules={[schedule()]} onDeleteSchedule={onDeleteSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDeleteSchedule).not.toHaveBeenCalled();
  });

  it('a deleted (cancelled) schedule no longer appears', () => {
    render(<AgentActivityPanel tasks={[]} schedules={[schedule({ status: 'cancelled' })]} />);
    expect(screen.queryByText('Scheduled')).toBeNull();
  });
});

describe('AgentActivityPanel — Goal row', () => {
  const goal: IGoalState = {
    id: 'goal_1',
    objective: 'Land the release notes',
    status: 'active',
    iterations: 2,
    maxIterations: 25,
    startedAt: '2026-05-01T00:00:00.000Z',
    progress: [],
  };

  it('shows nothing when there is no goal', () => {
    render(<AgentActivityPanel tasks={[]} goal={null} />);
    expect(screen.queryByText('Goal')).toBeNull();
  });

  it('shows the objective and its status in plain words', () => {
    render(<AgentActivityPanel tasks={[]} goal={goal} />);
    expect(screen.getByText('Land the release notes')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('Cancel goal sends the same action as /goal cancel', () => {
    const onCancelGoal = vi.fn();
    render(<AgentActivityPanel tasks={[]} goal={goal} onCancelGoal={onCancelGoal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel goal' }));
    expect(onCancelGoal).toHaveBeenCalledOnce();
  });

  it('a stopped goal has no Cancel control', () => {
    render(
      <AgentActivityPanel
        tasks={[]}
        goal={{ ...goal, status: 'stopped', stopReason: 'cancelled' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel goal' })).toBeNull();
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});
