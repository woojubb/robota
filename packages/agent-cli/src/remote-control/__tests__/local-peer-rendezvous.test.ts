import { mkdtempSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureRendezvousDirectory, resolveRendezvousDirectory } from '../local-peer-rendezvous.js';

/**
 * SEC-010 composition (#1862) — choosing WHERE the guarded rendezvous lives.
 *
 * The location decision is this package's; what `guarded` means is the security leaf's. These tests
 * pin the first and confirm the second still runs — a location decision must not be able to become
 * a security decision by accident.
 */
const made: string[] = [];

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-rv-')));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('#1862 — where the rendezvous goes', () => {
  it('prefers the runtime directory, which the system already keeps 0700 and cleans up', () => {
    const path = resolveRendezvousDirectory({ env: { XDG_RUNTIME_DIR: '/run/user/1000' } });

    expect(path).toBe('/run/user/1000/robota/peers');
  });

  it('falls back to the home directory where this package already keeps its state', () => {
    const path = resolveRendezvousDirectory({ env: {}, home: () => '/home/alice' });

    expect(path).toBe('/home/alice/.robota/peers');
  });

  it('treats a blank runtime directory as absent rather than as a root', () => {
    // `XDG_RUNTIME_DIR=''` would otherwise produce `robota/peers` — a RELATIVE path, created
    // wherever the process happens to be running.
    const path = resolveRendezvousDirectory({
      env: { XDG_RUNTIME_DIR: '  ' },
      home: () => '/home/alice',
    });

    expect(path).toBe('/home/alice/.robota/peers');
  });
});

describe('#1862 — the chosen path still goes through the security leaf', () => {
  it('creates it 0700 and returns the admission, not a boolean', () => {
    const home = scratch();

    const result = ensureRendezvousDirectory({ env: {}, home: () => home });

    expect(result.admitted).toBe(true);
    expect(result.trust).toBe('same-user-same-host');
    expect(result.binding?.guardedDirectory).toContain('.robota/peers');
    expect(statSync(join(home, '.robota', 'peers')).mode & 0o777).toBe(0o700);
  });

  it('a location that cannot be made is a refusal, never an unguarded fallback', () => {
    // Falling back to a directory that is merely writable would be the copyable-credential failure
    // SEC-010 exists to prevent, wearing a path.
    // A file, not a directory: `mkdir` under it cannot succeed, and the refusal is the security
    // leaf's own rather than a special case here.
    const home = scratch();
    const asFile = join(home, 'not-a-directory');
    writeFileSync(asFile, 'x', 'utf8');

    const result = ensureRendezvousDirectory({ env: { XDG_RUNTIME_DIR: asFile } });

    expect(result.admitted).toBe(false);
    expect(result.trust).toBe('unproven');
  });
});
