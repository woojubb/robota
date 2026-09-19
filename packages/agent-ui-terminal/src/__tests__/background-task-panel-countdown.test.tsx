import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import BackgroundTaskPanel from '../BackgroundTaskPanel.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

function makeEntry(overrides: Partial<IExecutionWorkspaceEntry>): IExecutionWorkspaceEntry {
  return {
    id: 'task:sched_1',
    sourceId: 'sched_1',
    kind: 'background_task',
    origin: { kind: 'slash_command', sessionId: 'session_1', commandName: 'schedule' },
    taskKind: 'scheduled',
    status: 'sleeping',
    state: 'working',
    title: 'wake',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-01-01T00:00:00.000Z',
    controls: ['select', 'cancel'],
    ...overrides,
  };
}

/** SCREEN-1992 TC-04: the tick advances the countdown once a second, only while one exists. */
describe('BackgroundTaskPanel countdown tick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances the rendered countdown every second while a schedule sleeps', async () => {
    const { lastFrame, rerender } = render(
      <BackgroundTaskPanel entries={[makeEntry({ nextFireAt: '2026-01-01T00:01:00.000Z' })]} />,
    );
    expect(lastFrame()).toContain('in 1m 0s');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastFrame()).toContain('in 59s');
    await vi.advanceTimersByTimeAsync(2000);
    expect(lastFrame()).toContain('in 57s');

    // No sleeping schedule ⇒ the tick stops: the frame no longer changes with time.
    rerender(
      <BackgroundTaskPanel entries={[makeEntry({ status: 'completed', state: 'completed' })]} />,
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(lastFrame()).not.toContain('in ');
  });

  it('never starts the tick in screen-reader mode', async () => {
    const { lastFrame } = render(
      <ScreenReaderProvider enabled>
        <BackgroundTaskPanel entries={[makeEntry({ nextFireAt: '2026-01-01T00:01:00.000Z' })]} />
      </ScreenReaderProvider>,
    );
    expect(lastFrame()).toContain('in 1m 0s');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(lastFrame()).toContain('in 1m 0s');
  });
});
