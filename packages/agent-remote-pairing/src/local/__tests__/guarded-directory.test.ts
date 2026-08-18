import { mkdtempSync, rmSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureGuardedDirectory, GUARDED_MODE } from '../guarded-directory.js';

/**
 * SEC-010 — creating the directory whose permissions are the proof.
 *
 * The umask cases run against a REAL filesystem, deliberately. The whole defect being guarded
 * against is that `mkdir(…, { mode: 0o700 })` returns successfully having produced 0755, and a
 * mocked `mkdir` cannot exhibit that — it would assert the mock's behaviour, not the kernel's.
 */
const made: string[] = [];

function scratch(): string {
  // mkdtemp, not join(tmpdir(), name): the OS chooses the name and creates it 0700 (SEC-003).
  const dir = mkdtempSync(path.join(tmpdir(), 'robota-guarded-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('SEC-010 — a created rendezvous directory is verified, not assumed', () => {
  it('creates it 0700 and admits it', () => {
    const target = path.join(scratch(), 'peers');

    const result = ensureGuardedDirectory(target, { expectedUid: process.getuid?.() ?? 0 });

    expect(result.admitted).toBe(true);
    expect(result.trust).toBe('same-user-same-host');
    expect(statSync(target).mode & 0o777).toBe(GUARDED_MODE);
  });

  it('a umask cannot widen the result, and this pins the reason the chmod is NOT for that', () => {
    // This test previously claimed the umask could turn a 0700 request into 0755, and it passed
    // with the chmod removed — an assertion that holds either way asserts nothing. A umask only
    // ever CLEARS bits, so the request can come back tighter and never looser.
    //
    // Kept, restated, because the wrong reason is worth one test to keep from being re-adopted:
    // if this ever fails, the platform's umask semantics changed and the module's justification
    // needs re-reading.
    const previous = process.umask(0o077);
    try {
      const target = path.join(scratch(), 'peers');

      ensureGuardedDirectory(target, { expectedUid: process.getuid?.() ?? 0 });

      expect(statSync(target).mode & 0o077).toBe(0);
    } finally {
      process.umask(previous);
    }
  });

  it('tightens a directory that already existed with wider permissions', () => {
    // `mkdir` with `recursive: true` succeeds on an existing directory WITHOUT touching its mode,
    // so a directory somebody else created 0777 would otherwise be adopted as ours.
    const target = path.join(scratch(), 'peers');
    mkdirSync(target);
    chmodSync(target, 0o777);

    const result = ensureGuardedDirectory(target, { expectedUid: process.getuid?.() ?? 0 });

    expect(result.admitted).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(GUARDED_MODE);
  });

  it('refuses when the post-creation check says the directory is not ours', () => {
    // The validation is not a formality: it is the step that would catch a mode or owner the two
    // calls above did not actually achieve. Driven here by claiming a uid we are not.
    const target = path.join(scratch(), 'peers');

    const result = ensureGuardedDirectory(target, { expectedUid: (process.getuid?.() ?? 0) + 1 });

    expect(result.admitted).toBe(false);
    expect(result.reason).toMatch(/belongs to uid/);
  });
});

describe('SEC-010 — a directory that could not be made is a refusal, never a pass', () => {
  it('refuses when creation throws', () => {
    const result = ensureGuardedDirectory('/anywhere', {
      expectedUid: 0,
      makeDirectory: () => {
        throw new Error('EACCES: permission denied');
      },
    });

    expect(result.admitted).toBe(false);
    expect(result.trust).toBe('unproven');
    expect(result.reason).toMatch(/could not be created.*EACCES/);
  });

  it('refuses when the mode could not be set, rather than using whatever mode it has', () => {
    const result = ensureGuardedDirectory('/anywhere', {
      expectedUid: 0,
      makeDirectory: () => {},
      setMode: () => {
        throw new Error('EPERM: operation not permitted');
      },
    });

    expect(result.admitted).toBe(false);
    expect(result.reason).toMatch(/could not be set to mode 0700/);
  });

  it('does not attempt a mode change on a directory that was never created', () => {
    // Reporting a mode change on nothing would be a second, misleading failure — and the first one
    // is the one that matters.
    let setModeCalls = 0;

    ensureGuardedDirectory('/anywhere', {
      expectedUid: 0,
      makeDirectory: () => {
        throw new Error('EACCES');
      },
      setMode: () => {
        setModeCalls += 1;
      },
    });

    expect(setModeCalls).toBe(0);
  });

  it('asks for 0700 at creation as well as after, so the window is as small as it can be', () => {
    // Belt and braces on purpose: the chmod is what guarantees it, but a directory that exists at
    // 0755 for even an instant is reachable in that instant.
    const requested: number[] = [];

    ensureGuardedDirectory('/anywhere', {
      expectedUid: 0,
      makeDirectory: (_t, mode) => requested.push(mode),
      setMode: () => {},
      statAt: () => ({
        uid: 0,
        mode: GUARDED_MODE,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }),
      resolve: (t) => t,
    });

    expect(requested).toEqual([GUARDED_MODE]);
  });
});
