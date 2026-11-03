/**
 * Who a process is beyond its pid, read from the real machine where the platform can answer.
 */

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  readBootId,
  readCurrentProcessIdentity,
  readPidNamespace,
  readProcessStartTime,
} from './process-identity.js';

const POSIX = process.platform === 'linux' || process.platform === 'darwin';

describe('readProcessStartTime', () => {
  it.runIf(POSIX)(
    'reads the same start time for a live process every time, and none for a process that is gone',
    () => {
      const first = readProcessStartTime(process.pid);

      expect(first).toMatch(/\S/u);
      expect(readProcessStartTime(process.pid)).toBe(first);
      const exited = spawnSync(process.execPath, ['-e', '']);
      expect(readProcessStartTime(exited.pid)).toBeUndefined();
    },
  );

  it('asks the macOS reader on macOS, and answers nothing on Windows unless the host supplies a reader', () => {
    const readDarwin = (pid: number): string | undefined =>
      pid === 123 ? 'darwin-birth' : undefined;
    const readWindows = (pid: number): string | undefined => (pid === 123 ? '133000' : undefined);

    expect(readProcessStartTime(123, { platform: 'darwin', readDarwin })).toBe('darwin-birth');
    expect(readProcessStartTime(123, { platform: 'win32' })).toBeUndefined();
    expect(readProcessStartTime(123, { platform: 'win32', readWindows })).toBe('133000');
  });

  it('answers nothing for a pid that is not a positive integer', () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(
        readProcessStartTime(pid, { platform: 'darwin', readDarwin: () => 'x' }),
      ).toBeUndefined();
    }
  });
});

describe('readBootId', () => {
  it.runIf(POSIX)('names the current boot the same way on every read', () => {
    const boot = readBootId();

    expect(boot).toMatch(
      /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u,
    );
    expect(readBootId()).toBe(boot);
  });

  it('has no boot identity on a platform that offers none', () => {
    expect(readBootId('win32')).toBeUndefined();
  });
});

describe('readPidNamespace', () => {
  it.runIf(process.platform === 'linux')('names the pid namespace on Linux', () => {
    expect(readPidNamespace()).toMatch(/^pid:\[\d+\]$/u);
  });

  it('has none where the platform has no pid namespaces', () => {
    expect(readPidNamespace('darwin')).toBeUndefined();
    expect(readPidNamespace('win32')).toBeUndefined();
  });
});

describe('readCurrentProcessIdentity', () => {
  it('describes this process with the same readers a later observer uses', () => {
    const identity = readCurrentProcessIdentity();

    expect(identity.pid).toBe(process.pid);
    expect(identity.startTime).toBe(readProcessStartTime(process.pid));
    expect(identity.bootId).toBe(readBootId());
    expect(identity.pidNamespace).toBe(readPidNamespace());
  });
});
