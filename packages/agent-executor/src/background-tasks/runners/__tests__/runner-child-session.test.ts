/**
 * Background process and scheduled tasks already ran in their own session on POSIX, so their spawn
 * options are the same in both modes. In secure mode this process also ends their group when it
 * ends, since nothing else would: plain mode keeps that to the session's own shutdown.
 */

import { EventEmitter } from 'node:events';
import { spawn as spawnMock } from 'node:child_process';

import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedShellProcessRunner } from '../managed-shell-process-runner.js';
import { createScheduledTaskRunner } from '../scheduled-task-runner.js';

import type { IBackgroundTaskStart } from '../../types.js';

const cronState = vi.hoisted(() => ({ fire: undefined as (() => void) | undefined }));
const children = vi.hoisted(() => [] as EventEmitter[]);

vi.mock('node:child_process', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new Emitter(), {
        pid: 4242,
        stdin: { once: vi.fn(), off: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      });
      children.push(child);
      return child;
    }),
  };
});

vi.mock('croner', () => ({
  Cron: class {
    constructor(_expression: string, _options: unknown, fire: () => void) {
      cronState.fire = fire;
    }
    nextRun(): Date {
      return new Date('2030-01-01T00:00:00.000Z');
    }
    stop(): void {}
    pause(): void {}
    resume(): void {}
  },
}));

const POSIX = process.platform !== 'win32';
const request = {
  command: 'sentinel',
  shell: '/bin/sh',
  mode: 'background' as const,
  parentSessionId: 'session_1',
  depth: 0,
  cwd: process.cwd(),
};
const processTask: IBackgroundTaskStart<'process'> = {
  taskId: 'process_1',
  request: { ...request, kind: 'process', label: 'process' },
};
const scheduledTask: IBackgroundTaskStart<'scheduled'> = {
  taskId: 'scheduled_1',
  request: { ...request, kind: 'scheduled', label: 'scheduled', cronExpression: '* * * * *' },
};

function startBoth(): unknown[] {
  createManagedShellProcessRunner().start(processTask);
  createScheduledTaskRunner().start(scheduledTask);
  cronState.fire?.();
  return vi.mocked(spawnMock).mock.calls.map((call) => call[2]);
}

beforeEach(() => {
  vi.mocked(spawnMock).mockClear();
  children.length = 0;
  cronState.fire = undefined;
});

afterEach(() => {
  for (const child of children) child.emit('exit', 0, null);
  resetChildSessionsForTesting();
});

describe('background process and scheduled tasks', () => {
  it('start with the options they always had in plain mode, and nothing ends them with the process', () => {
    const exitListeners = process.listenerCount('exit');
    const [processOptions, scheduledOptions] = startBoth();

    expect(processOptions).toEqual({
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: POSIX,
    });
    expect(scheduledOptions).toEqual({
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: POSIX,
    });
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });

  it.skipIf(!POSIX)(
    'keep those options in secure mode, and their groups end with this process',
    () => {
      const exitListeners = process.listenerCount('exit');
      const plain = startBoth();
      for (const child of children.splice(0)) child.emit('exit', 0, null);
      vi.mocked(spawnMock).mockClear();
      enableOwnChildSessions();

      expect(startBoth()).toEqual(plain);
      expect(process.listenerCount('exit')).toBe(exitListeners + 1);
      for (const child of children.splice(0)) child.emit('exit', 0, null);
      expect(process.listenerCount('exit')).toBe(exitListeners);
    },
  );
});
