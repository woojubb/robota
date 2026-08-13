import { describe, expect, it } from 'vitest';

import {
  OPEN_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  classifyTaskLifecycle,
} from '../task-lifecycle.mjs';

const task = (status, completed = undefined, body = '') =>
  [
    '---',
    `status: ${status}`,
    ...(completed === undefined ? [] : [`completed: ${completed}`]),
    '---',
    body,
  ].join('\n');

describe('canonical Task lifecycle classification', () => {
  it.each(['todo', 'in-progress', 'blocked'])('classifies %s as open', (status) => {
    expect(classifyTaskLifecycle(task(status))).toMatchObject({
      status,
      state: 'open',
      valid: true,
    });
  });

  it.each(['done', 'wontfix', 'skipped', 'superseded'])(
    'classifies %s as terminal only with a valid completion date',
    (status) => {
      expect(classifyTaskLifecycle(task(status, '2026-08-14'))).toMatchObject({
        status,
        state: 'terminal',
        valid: true,
      });
      expect(classifyTaskLifecycle(task(status))).toMatchObject({
        state: 'terminal',
        valid: false,
      });
      expect(classifyTaskLifecycle(task(status, '2026-02-30'))).toMatchObject({
        state: 'terminal',
        valid: false,
      });
    },
  );

  it('does not infer lifecycle from body prose', () => {
    expect(classifyTaskLifecycle('# Task\n\nStatus: completed')).toMatchObject({
      status: null,
      state: 'invalid',
      valid: false,
    });
    expect(
      classifyTaskLifecycle(task('in-progress', undefined, 'Status: completed')),
    ).toMatchObject({
      status: 'in-progress',
      state: 'open',
      valid: true,
    });
  });

  it('exports the complete vocabulary once', () => {
    expect([...OPEN_TASK_STATUSES]).toEqual(['todo', 'in-progress', 'blocked']);
    expect([...TERMINAL_TASK_STATUSES]).toEqual(['done', 'wontfix', 'skipped', 'superseded']);
  });
});
