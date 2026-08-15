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

function task(kind: 'process' | 'scheduled', shell: string): IBackgroundTaskStart {
  return {
    taskId: `${kind}_1`,
    request:
      kind === 'process'
        ? {
            kind,
            command: 'sentinel',
            shell,
            label: kind,
            mode: 'background',
            parentSessionId: 'session_1',
            depth: 0,
            cwd: process.cwd(),
          }
        : {
            kind,
            cronExpression: '* * * * *',
            command: 'sentinel',
            shell,
            label: kind,
            mode: 'background',
            parentSessionId: 'session_1',
            depth: 0,
            cwd: process.cwd(),
          },
  };
}

describe('executor runner shell contract', () => {
  beforeEach(() => {
    vi.mocked(spawnMock).mockClear();
    cronState.fire = undefined;
  });

  it('passes the same explicit PowerShell executable/args pair through the managed runner', () => {
    createManagedShellProcessRunner().start(task('process', '/opt/pwsh'));
    expect(vi.mocked(spawnMock).mock.calls[0]?.slice(0, 2)).toEqual([
      '/opt/pwsh',
      ['-NoProfile', '-Command', 'sentinel'],
    ]);
  });

  it('passes the same explicit cmd executable/args pair through the scheduled runner', () => {
    createScheduledTaskRunner().start(task('scheduled', 'C:\\Windows\\System32\\cmd.exe'));
    cronState.fire?.();
    expect(vi.mocked(spawnMock).mock.calls[0]?.slice(0, 2)).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'sentinel'],
    ]);
  });

  it.each(['process', 'scheduled'] as const)(
    'rejects an unknown explicit shell before the %s runner spawns',
    (kind) => {
      const runner =
        kind === 'process' ? createManagedShellProcessRunner() : createScheduledTaskRunner();
      expect(() => runner.start(task(kind, '/opt/fish'))).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_SHELL', executable: '/opt/fish' }),
      );
      expect(spawnMock).not.toHaveBeenCalled();
    },
  );
});
