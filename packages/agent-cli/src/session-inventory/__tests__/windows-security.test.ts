import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertWindowsPrivatePath,
  currentWindowsSid,
  isPrivateWindowsSddl,
  createWindowsPrivateDirectory,
  readWindowsProcessIdentity,
  readWindowsProcessStartTime,
} from '../windows-security.js';
import { readProcessStartTime } from '../../remote-control/local-peer-registry.js';

const SID = 'S-1-5-21-1-2-3-1001';

describe('Windows daemon security', () => {
  it('accepts a protected descriptor granting only this user access', () => {
    expect(isPrivateWindowsSddl(`O:${SID}D:P(A;OICI;FA;;;${SID})`, SID, true)).toBe(true);
    expect(isPrivateWindowsSddl(`O:BAD:PAI(A;;FA;;;${SID})(A;;FA;;;SY)`, SID, true)).toBe(true);
  });

  it('compares fixed service account aliases with the exact numeric account', () => {
    expect(isPrivateWindowsSddl('O:SYD:P(A;OICI;FA;;;SY)', 'S-1-5-18', true)).toBe(true);
    expect(isPrivateWindowsSddl('O:LSD:P(A;OICI;FA;;;LS)', 'S-1-5-19', true)).toBe(true);
    expect(isPrivateWindowsSddl('O:SYD:P(A;OICI;FA;;;SY)', SID, true)).toBe(false);
    expect(isPrivateWindowsSddl(`O:${SID}D:P(A;;FA;;;LS)(A;;FA;;;${SID})`, SID, true)).toBe(false);
  });

  it('refuses public, inherited, null, incomplete, and foreign-owner descriptors', () => {
    for (const descriptor of [
      `O:${SID}D:P(A;;FA;;;WD)(A;;FA;;;${SID})`,
      `O:${SID}D:AI(A;;FA;;;${SID})`,
      `O:${SID}D:NO_ACCESS_CONTROL`,
      `O:${SID}D:P(A;;FR;;;${SID})`,
      `O:S-1-5-21-9D:P(A;;FA;;;${SID})`,
      `O:${SID}D:P(A;IO;FA;;;${SID})`,
      `O:${SID}D:P(A;;FA;;;${SID})junk`,
    ])
      expect(isPrivateWindowsSddl(descriptor, SID, true)).toBe(false);
  });

  it('allows inherited files only when the ACL still grants no other unprivileged account access', () => {
    expect(isPrivateWindowsSddl(`O:${SID}D:AI(A;ID;FA;;;${SID})`, SID, false)).toBe(true);
    expect(isPrivateWindowsSddl(`O:${SID}D:AI(A;ID;FA;;;AU)`, SID, false)).toBe(false);
  });

  it('distinguishes local administrators by their complete account SID', () => {
    const local = 'S-1-5-21-1-2-3-500';
    const foreign = 'S-1-5-21-4-5-6-500';
    expect(isPrivateWindowsSddl(`O:${local}D:P(A;;FA;;;${local})`, local, true)).toBe(true);
    expect(isPrivateWindowsSddl(`O:${foreign}D:P(A;;FA;;;${local})`, local, true)).toBe(false);
    expect(isPrivateWindowsSddl(`O:${local}D:P(A;;FA;;;${foreign})`, local, true)).toBe(false);
    expect(isPrivateWindowsSddl('O:LAD:P(A;;FA;;;LA)', local, true)).toBe(false);
  });

  it('selects the Windows creation-time reader instead of /proc', () => {
    expect(
      readProcessStartTime(
        123,
        'win32',
        () => undefined,
        () => '133700000000000001',
      ),
    ).toBe('133700000000000001');
  });

  it.runIf(process.platform === 'win32')('reads this actual Windows process identity', () => {
    expect(readWindowsProcessStartTime(process.pid)).toMatch(/^[0-9]+$/);
    expect(readWindowsProcessIdentity(process.pid)).toEqual({
      sid: currentWindowsSid(),
      startedAt: readWindowsProcessStartTime(process.pid),
    });
    expect(readWindowsProcessStartTime(0)).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')(
    'protects storage before secrets and refuses exposed files and junctions',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'test-product-acl-test-'));
      try {
        const storage = join(root, 'storage');
        mkdirSync(storage);
        expect(() => assertWindowsPrivatePath(storage, true)).toThrow();
        expect(() => createWindowsPrivateDirectory(storage)).toThrow(/not private/);
        rmSync(storage, { recursive: true });
        execFileSync('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)F']);
        createWindowsPrivateDirectory(storage);
        expect(() => createWindowsPrivateDirectory(storage, true)).toThrow(/already exists/);
        expect(() => assertWindowsPrivatePath(storage, true)).not.toThrow();
        const registration = join(storage, 'registration.json');
        writeFileSync(registration, '{}');
        expect(() => assertWindowsPrivatePath(registration, false)).not.toThrow();
        execFileSync('icacls.exe', [registration, '/grant', '*S-1-1-0:R']);
        expect(() => assertWindowsPrivatePath(registration, false)).toThrow(/not private/);
        const junction = join(root, 'junction');
        symlinkSync(storage, junction, 'junction');
        expect(() => assertWindowsPrivatePath(junction, true)).toThrow(/reparse/);
        expect(() => createWindowsPrivateDirectory(junction)).toThrow(/reparse/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
