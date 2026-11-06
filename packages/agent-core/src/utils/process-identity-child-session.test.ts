/**
 * The identity readers start `ps`, `sysctl` and `ioreg`. In secure mode they run in their own session;
 * in plain mode they get exactly the options they always had.
 */

import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableOwnChildSessions } from '../node.js';
import { resetChildSessionsForTesting } from '../testing/index.js';
import { readBootId, readDarwinStartTime, readMachineId } from './process-identity.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(() => 'answer\n') };
});

afterEach(() => {
  resetChildSessionsForTesting();
  vi.mocked(execFileSync).mockClear();
});

function readAll(): Array<[unknown, unknown, Record<string, unknown>]> {
  readDarwinStartTime(4242);
  readBootId('darwin');
  readMachineId({ platform: 'darwin' });
  return vi.mocked(execFileSync).mock.calls as unknown as Array<
    [unknown, unknown, Record<string, unknown>]
  >;
}

describe('the identity readers', () => {
  it('give each probe the options it always had in plain mode', () => {
    const calls = readAll();

    expect(calls.map(([file, , options]) => [file, options])).toEqual([
      [
        '/bin/ps',
        { encoding: 'utf8', timeout: 1000, maxBuffer: 128, env: { TZ: 'UTC', LC_ALL: 'C' } },
      ],
      [
        '/usr/sbin/sysctl',
        { encoding: 'utf8', timeout: 1000, maxBuffer: 128, env: { LC_ALL: 'C' } },
      ],
      [
        '/usr/sbin/ioreg',
        { encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024, env: { LC_ALL: 'C' } },
      ],
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'start each probe in its own session, its options otherwise unchanged, in secure mode',
    () => {
      enableOwnChildSessions();
      const calls = readAll();

      expect(calls).toHaveLength(3);
      for (const [, , options] of calls) {
        expect(options).toMatchObject({ detached: true });
        expect(options).not.toHaveProperty('stdio');
      }
    },
  );
});
