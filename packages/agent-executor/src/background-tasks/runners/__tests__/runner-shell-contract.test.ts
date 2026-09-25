import { spawn as spawnMock } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedShellProcessRunner } from '../managed-shell-process-runner.js';
import { createScheduledTaskRunner } from '../scheduled-task-runner.js';

import type { IBackgroundTaskStart } from '../../types.js';

const cronState = vi.hoisted(() => ({ fire: undefined as (() => void) | undefined }));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 123,
    stdin: { once: vi.fn(), off: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })),
}));

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

function baseRequest(shell: string) {
  return {
    command: 'sentinel',
    shell,
    mode: 'background' as const,
    parentSessionId: 'session_1',
    depth: 0,
    cwd: process.cwd(),
  };
}

function processTask(shell: string): IBackgroundTaskStart<'process'> {
  return {
    taskId: 'process_1',
    request: { ...baseRequest(shell), kind: 'process', label: 'process' },
  };
}

function scheduledTask(shell: string): IBackgroundTaskStart<'scheduled'> {
  return {
    taskId: 'scheduled_1',
    request: {
      ...baseRequest(shell),
      kind: 'scheduled',
      label: 'scheduled',
      cronExpression: '* * * * *',
    },
  };
}

describe('executor runner shell contract', () => {
  beforeEach(() => {
    vi.mocked(spawnMock).mockClear();
    cronState.fire = undefined;
  });

  it('passes the same explicit PowerShell executable/args pair through the managed runner', () => {
    createManagedShellProcessRunner().start(processTask('/opt/pwsh'));
    expect(vi.mocked(spawnMock).mock.calls[0]?.slice(0, 2)).toEqual([
      '/opt/pwsh',
      ['-NoProfile', '-Command', 'sentinel'],
    ]);
  });

  it('passes the same explicit cmd executable/args pair through the scheduled runner', () => {
    createScheduledTaskRunner().start(scheduledTask('C:\\Windows\\System32\\cmd.exe'));
    cronState.fire?.();
    expect(vi.mocked(spawnMock).mock.calls[0]?.slice(0, 2)).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'sentinel'],
    ]);
  });

  it.each(['process', 'scheduled'] as const)(
    'rejects an unknown explicit shell before the %s runner spawns',
    (kind) => {
      const start = () =>
        kind === 'process'
          ? createManagedShellProcessRunner().start(processTask('/opt/fish'))
          : createScheduledTaskRunner().start(scheduledTask('/opt/fish'));
      expect(start).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_SHELL', executable: '/opt/fish' }),
      );
      expect(spawnMock).not.toHaveBeenCalled();
    },
  );
});
