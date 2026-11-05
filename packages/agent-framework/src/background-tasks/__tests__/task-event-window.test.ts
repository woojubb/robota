/**
 * The window of a fork job's recent events (#3679 3f, live follow).
 *
 * A surface that follows a job needs what the job is doing now, and needs it from the first moment it
 * looks, not only from then on. The parent already receives every event, so it keeps a small,
 * bounded, in-memory window of them per fork — the rows a follower reads — and nothing else of it
 * lives anywhere: it is never saved, and it goes with the task.
 */
import { describe, expect, it } from 'vitest';

import {
  TASK_EVENT_WINDOW_MAX_BYTES,
  TASK_EVENT_WINDOW_MAX_ROWS,
  TASK_EVENT_WINDOW_ROW_CHARACTERS,
  TaskEventWindow,
  TaskEventWindows,
} from '../task-event-window.js';

import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';

const ENTRY = 'task:agent_1';
const NOW = (): string => '2026-11-05T00:00:00.000Z';

function text(
  delta: string,
): Extract<TBackgroundTaskEvent, { type: 'background_task_text_delta' }> {
  return { type: 'background_task_text_delta', taskId: 'agent_1', delta };
}

function toolStart(toolName: string, firstArg?: string): TBackgroundTaskEvent {
  return {
    type: 'background_task_tool_start',
    taskId: 'agent_1',
    toolName,
    ...(firstArg === undefined ? {} : { firstArg }),
  };
}

function toolEnd(toolName: string, success: boolean, error?: string): TBackgroundTaskEvent {
  return {
    type: 'background_task_tool_end',
    taskId: 'agent_1',
    toolName,
    success,
    ...(error === undefined ? {} : { error }),
  };
}

function task(
  overrides: Partial<IBackgroundTaskState<'agent'>> = {},
): IBackgroundTaskState<'agent'> {
  return {
    id: 'agent_1',
    kind: 'agent',
    label: 'fork',
    status: 'running',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/work',
    updatedAt: '2026-11-05T00:00:00.000Z',
    unread: false,
    resumeSessionId: 'session_fork',
    ...overrides,
  };
}

function rows(window: TaskEventWindow): Array<[string, string]> {
  return window.page(ENTRY).records.map((record) => [record.kind, record.text]);
}

describe('a task event window', () => {
  it('coalesces streamed text into one row and keeps a tool call as its own row', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record(text('Looking at '));
    window.record(text('the parser.'));
    window.record(toolStart('Read', '/src/parser.ts'));
    window.record(toolEnd('Read', true));
    window.record(text('Found it.'));

    expect(rows(window)).toEqual([
      ['message', 'Looking at the parser.'],
      ['tool_activity', 'Read /src/parser.ts — done'],
      ['message', 'Found it.'],
    ]);
  });

  it('marks a tool call that failed, with why, and one whose start it never saw', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record(toolStart('Bash', 'pnpm test'));
    window.record(toolEnd('Bash', false, 'exit 1'));
    window.record(toolEnd('Glob', true));

    expect(rows(window)).toEqual([
      ['tool_activity', 'Bash pnpm test — failed: exit 1'],
      ['tool_activity', 'Glob — done'],
    ]);
  });

  it('pairs a tool end with the call still open for that tool', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record(toolStart('Read', 'a'));
    window.record(toolStart('Grep', 'b'));
    window.record(toolEnd('Grep', true));
    window.record(toolEnd('Read', true));

    expect(rows(window).map(([, row]) => row)).toEqual(['Read a — done', 'Grep b — done']);
  });

  it('shows a permission request, a message the person sent, and how the job ended', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record({
      type: 'background_task_permission_request',
      taskId: 'agent_1',
      requestId: 'p1',
      toolName: 'Write',
      toolArgs: {},
    });
    window.recordSent('please also add a test');
    window.record({
      type: 'background_task_completed',
      task: task({
        status: 'completed',
        result: { taskId: 'agent_1', kind: 'agent', output: 'all done' },
      }),
    });

    expect(rows(window)).toEqual([
      ['progress', 'Waiting for permission: Write'],
      ['message', 'You: please also add a test'],
      ['result', 'all done'],
    ]);
  });

  it('shows a failed job with its error and a cancelled one as stopped', () => {
    const failed = new TaskEventWindow('agent_1', NOW);
    failed.record({
      type: 'background_task_failed',
      task: task({
        status: 'failed',
        error: { category: 'runner', message: 'the provider refused', recoverable: false },
      }),
    });
    const cancelled = new TaskEventWindow('agent_1', NOW);
    cancelled.record({
      type: 'background_task_cancelled',
      task: task({ status: 'cancelled' }),
    });

    expect(rows(failed)).toEqual([['error', 'the provider refused']]);
    expect(rows(cancelled)).toEqual([['error', 'Cancelled']]);
  });

  it('ignores the events that only restate the task state', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record({ type: 'background_task_created', task: task() });
    window.record({ type: 'background_task_started', task: task() });
    window.record({ type: 'background_task_updated', task: task() });
    window.record({ type: 'background_task_waking', taskId: 'agent_1' });
    window.record({ type: 'background_task_closed', taskId: 'agent_1' });

    expect(window.page(ENTRY).records).toEqual([]);
  });

  it('keeps every row at most one row of characters, even from one huge delta', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    window.record(text('x'.repeat(TASK_EVENT_WINDOW_ROW_CHARACTERS * 2 + 5)));

    expect(rows(window).map(([, row]) => row.length)).toEqual([
      TASK_EVENT_WINDOW_ROW_CHARACTERS,
      TASK_EVENT_WINDOW_ROW_CHARACTERS,
      5,
    ]);
  });

  it('never splits a character in two', () => {
    const window = new TaskEventWindow('agent_1', NOW);
    // A pair of UTF-16 units that would straddle the row boundary.
    window.record(text(`${'x'.repeat(TASK_EVENT_WINDOW_ROW_CHARACTERS - 1)}😀tail`));

    const shown = rows(window).map(([, row]) => row);

    expect(shown.join('')).toBe(`${'x'.repeat(TASK_EVENT_WINDOW_ROW_CHARACTERS - 1)}😀tail`);
    for (const row of shown) expect(row).not.toMatch(/[\ud800-\udbff]$/u);
  });

  it('keeps the newest rows and says how many it let go, whatever the input', () => {
    const window = new TaskEventWindow('agent_1', NOW);
    const delta = 'abcdefghij'.repeat(10);
    const deltas = 10_000;

    for (let index = 0; index < deltas; index += 1) window.record(text(delta));

    const page = window.page(ENTRY);
    const [header, ...shown] = page.records;
    const created = Math.ceil((deltas * delta.length) / TASK_EVENT_WINDOW_ROW_CHARACTERS);
    expect(shown.length).toBeLessThanOrEqual(TASK_EVENT_WINDOW_MAX_ROWS);
    expect(
      shown.reduce((sum, record) => sum + new TextEncoder().encode(record.text).byteLength, 0),
    ).toBeLessThanOrEqual(TASK_EVENT_WINDOW_MAX_BYTES);
    expect(header?.kind).toBe('progress');
    expect(header?.text).toBe(`[${created - shown.length} earlier rows are not kept here]`);
    // The newest text is what is kept: the last row ends the stream.
    expect(shown.at(-1)?.text.endsWith('abcdefghij')).toBe(true);
    // One page: nothing later to read.
    expect(page.nextCursor).toBeUndefined();
  });

  it('bounds the bytes as well as the rows, for text that is wide in UTF-8', () => {
    const window = new TaskEventWindow('agent_1', NOW);

    for (let index = 0; index < 200; index += 1) {
      window.record(text('\uac00'.repeat(TASK_EVENT_WINDOW_ROW_CHARACTERS)));
    }

    const shown = window.page(ENTRY).records.filter((record) => record.kind === 'message');
    const bytes = shown.reduce(
      (sum, record) => sum + new TextEncoder().encode(record.text).byteLength,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(TASK_EVENT_WINDOW_MAX_BYTES);
    expect(shown.length).toBeGreaterThan(0);
  });

  it('gives every row a stable id, so a follower that re-reads keeps its place', () => {
    const window = new TaskEventWindow('agent_1', NOW);
    window.record(text('first'));
    const before = window.page(ENTRY).records.map((record) => record.id);

    window.record(toolStart('Read'));
    window.record(text('second'));
    const after = window.page(ENTRY).records.map((record) => record.id);

    expect(after.slice(0, before.length)).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });
});

describe('the windows of a session', () => {
  const isFork = (taskId: string): boolean => taskId === 'agent_1';

  it('keeps a window for a fork and none for any other task', () => {
    const windows = new TaskEventWindows(isFork, NOW);

    windows.record(text('fork text'));
    windows.record({ ...text('plain text'), taskId: 'agent_2' });

    expect(windows.has('agent_1')).toBe(true);
    expect(windows.has('agent_2')).toBe(false);
    expect(windows.page('agent_2', 'task:agent_2')).toBeUndefined();
  });

  it('frees the window when the task is closed', () => {
    const windows = new TaskEventWindows(isFork, NOW);
    windows.record(text('fork text'));

    windows.record({ type: 'background_task_closed', taskId: 'agent_1' });

    expect(windows.has('agent_1')).toBe(false);
  });

  it('keeps the window of a task that ended until it is closed', () => {
    const windows = new TaskEventWindows(isFork, NOW);
    windows.record(text('fork text'));
    windows.record({
      type: 'background_task_completed',
      task: task({
        status: 'completed',
        result: { taskId: 'agent_1', kind: 'agent', output: 'done' },
      }),
    });

    expect(windows.page('agent_1', ENTRY)?.records.map((record) => record.kind)).toEqual([
      'message',
      'result',
    ]);
  });

  it('echoes a sent message only into a window that exists', () => {
    const windows = new TaskEventWindows(isFork, NOW);

    windows.recordSent('agent_2', 'nobody follows this');
    windows.recordSent('agent_1', 'nobody has a window yet');

    expect(windows.has('agent_1')).toBe(false);
    expect(windows.has('agent_2')).toBe(false);
  });

  it('is emptied by clear', () => {
    const windows = new TaskEventWindows(isFork, NOW);
    windows.record(text('fork text'));

    windows.clear();

    expect(windows.has('agent_1')).toBe(false);
  });
});
