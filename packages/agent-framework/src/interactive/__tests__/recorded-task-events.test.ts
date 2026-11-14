import { describe, expect, it } from 'vitest';

import {
  MAX_RECORDED_STREAM_EVENTS,
  MAX_RECORDED_TRANSITION_EVENTS,
  RecordedTaskEvents,
  isDurableTaskTransition,
  isStreamTaskEvent,
} from '../recorded-task-events.js';

import type {
  IAgentBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface/execution';

function task(id: string, overrides: Partial<IAgentBackgroundTaskState> = {}) {
  const state: IAgentBackgroundTaskState = {
    id,
    kind: 'agent',
    label: 'worker',
    status: 'running',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unread: false,
    ...overrides,
  };
  return state;
}

function delta(taskId: string, text: string): TBackgroundTaskEvent {
  return { type: 'background_task_text_delta', taskId, delta: text };
}

function created(id: string): TBackgroundTaskEvent {
  return { type: 'background_task_created', task: task(id) };
}

describe('the task events a record carries', () => {
  it('keeps events in the order they came', () => {
    const events = new RecordedTaskEvents();
    const pushed = [
      created('a'),
      delta('a', '1'),
      { type: 'background_task_tool_start', taskId: 'a', toolName: 'Read' } as const,
      { type: 'background_task_closed', taskId: 'b' } as const,
      delta('a', '2'),
    ];
    for (const event of pushed) events.push(event);

    expect(events.toArray()).toEqual(pushed);
  });

  it('keeps a job’s lifecycle however much it streams afterwards', () => {
    const events = new RecordedTaskEvents();
    events.push(created('a'));
    for (let index = 0; index < MAX_RECORDED_STREAM_EVENTS * 4; index += 1) {
      events.push(delta('a', `chunk ${index}`));
    }

    const kept = events.toArray();
    expect(kept).toHaveLength(1 + MAX_RECORDED_STREAM_EVENTS);
    expect(kept[0]).toEqual(created('a'));
    expect(kept.at(-1)).toEqual(delta('a', `chunk ${MAX_RECORDED_STREAM_EVENTS * 4 - 1}`));
    expect(kept[1]).toEqual(delta('a', `chunk ${MAX_RECORDED_STREAM_EVENTS * 3}`));
  });

  it('keeps recent output however many lifecycle events come after it', () => {
    const events = new RecordedTaskEvents();
    events.push(delta('a', 'last words'));
    for (let index = 0; index < MAX_RECORDED_TRANSITION_EVENTS * 2; index += 1) {
      events.push({ type: 'background_task_waking', taskId: `t${index}` });
    }

    const kept = events.toArray();
    expect(kept).toHaveLength(1 + MAX_RECORDED_TRANSITION_EVENTS);
    expect(kept[0]).toEqual(delta('a', 'last words'));
    expect(kept.at(-1)).toEqual({
      type: 'background_task_waking',
      taskId: `t${MAX_RECORDED_TRANSITION_EVENTS * 2 - 1}`,
    });
  });

  it('bounds what a record written without a bound already carries, newest and in order', () => {
    const carried: TBackgroundTaskEvent[] = [];
    for (let index = 0; index < 3000; index += 1) {
      carried.push(
        index % 3 === 0
          ? { type: 'background_task_closed', taskId: `t${index}` }
          : delta('a', `${index}`),
      );
    }

    const kept = new RecordedTaskEvents(carried).toArray();

    expect(kept.length).toBeLessThanOrEqual(
      MAX_RECORDED_TRANSITION_EVENTS + MAX_RECORDED_STREAM_EVENTS,
    );
    expect(kept.at(-1)).toEqual(carried.at(-1));
    expect(kept).toEqual(carried.filter((event) => kept.includes(event)));
  });
});

describe('which task events are saved when they happen', () => {
  it('waits for the next save for output and tool activity', () => {
    const streamed: TBackgroundTaskEvent[] = [
      delta('a', 'x'),
      { type: 'background_task_tool_start', taskId: 'a', toolName: 'Read' },
      { type: 'background_task_tool_end', taskId: 'a', toolName: 'Read', success: true },
      {
        type: 'background_task_permission_request',
        taskId: 'a',
        requestId: 'r',
        toolName: 'Bash',
        toolArgs: {},
      },
    ];
    for (const event of streamed) {
      expect(isStreamTaskEvent(event)).toBe(true);
      expect(isDurableTaskTransition(event, [task('a')])).toBe(false);
    }
  });

  it('saves a task’s lifecycle at once', () => {
    const lifecycle: TBackgroundTaskEvent[] = [
      created('a'),
      { type: 'background_task_started', task: task('a') },
      { type: 'background_task_completed', task: task('a', { status: 'completed' }) },
      { type: 'background_task_failed', task: task('a', { status: 'failed' }) },
      { type: 'background_task_cancelled', task: task('a', { status: 'cancelled' }) },
      { type: 'background_task_closed', taskId: 'a' },
      { type: 'background_task_waking', taskId: 'a' },
    ];
    for (const event of lifecycle) {
      expect(isStreamTaskEvent(event)).toBe(false);
      expect(isDurableTaskTransition(event, [task('a')])).toBe(true);
    }
  });

  it('waits for an update that moved only what a running task rewrites on every sign of life', () => {
    const before = task('a', {
      currentAction: 'Read a.ts',
      lastActivityAt: '2026-01-01T00:00:01.000Z',
    });
    const moved = task('a', {
      currentAction: 'Edit b.ts',
      lastActivityAt: '2026-01-01T00:00:05.000Z',
      updatedAt: '2026-01-01T00:00:05.000Z',
    });

    expect(
      isDurableTaskTransition({ type: 'background_task_updated', task: moved }, [before]),
    ).toBe(false);
  });

  it('saves an update that changed anything else, or of a task it has not seen', () => {
    const before = task('a');

    for (const changed of [
      task('a', { status: 'paused' }),
      task('a', { transcriptPath: '/tmp/a.jsonl' }),
      task('a', { label: 'renamed' }),
    ]) {
      expect(
        isDurableTaskTransition({ type: 'background_task_updated', task: changed }, [before]),
      ).toBe(true);
    }
    expect(
      isDurableTaskTransition({ type: 'background_task_updated', task: task('b') }, [before]),
    ).toBe(true);
  });
});
