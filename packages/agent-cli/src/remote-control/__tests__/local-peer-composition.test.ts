import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openLocalPeerRendezvous } from '../local-peer-admission.js';
import { ensureRendezvousDirectory } from '../local-peer-rendezvous.js';

/**
 * SEC-010 composition (#1862) — the three layers as one path.
 *
 * Each layer has its own tests. This asserts they COMPOSE: a directory the security leaf verified,
 * a ledger keyed on that directory, and a redeem port shaped the way the WebRTC gate consumes it.
 * Every layer passing separately is not the same as the path working — that gap is exactly what
 * "declared but never wired" looks like, and this repository has now met it several times.
 */
const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'robota-comp-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('#1862 — directory → ledger → gate port', () => {
  it('a verified directory yields a port that admits its own grant', () => {
    const admission = ensureRendezvousDirectory({ env: {}, home: () => scratch() });
    expect(admission.admitted).toBe(true);

    const rv = openLocalPeerRendezvous({
      guardedDirectory: admission.binding?.guardedDirectory ?? '',
    });

    const result = rv.redeem(rv.issueGrant('session_a').nonce);
    expect(result.admitted).toBe(true);
    expect(result.trust).toBe('same-user-same-host');
  });

  it('the port satisfies the shape the gate asks for', () => {
    // The gate takes `{ redeem: (nonce: string) => IPeerAdmission }`. Asserting the SHAPE rather
    // than importing the gate keeps this package free of a dependency it does not otherwise need,
    // while still failing if the port stops being callable the way the gate calls it.
    const admission = ensureRendezvousDirectory({ env: {}, home: () => scratch() });
    const rv = openLocalPeerRendezvous({
      guardedDirectory: admission.binding?.guardedDirectory ?? '',
    });

    const port: { redeem: (nonce: string) => { admitted: boolean } } = rv;

    expect(typeof port.redeem).toBe('function');
    expect(port.redeem('not-a-real-nonce').admitted).toBe(false);
  });

  it('a grant from one rendezvous is not honoured by another', () => {
    // Two sessions with separate guarded directories must not admit each other's peers — the
    // binding is to a rendezvous, not to the machine at large.
    const a = ensureRendezvousDirectory({ env: {}, home: () => scratch() });
    const b = ensureRendezvousDirectory({ env: {}, home: () => scratch() });
    const rvA = openLocalPeerRendezvous({ guardedDirectory: a.binding?.guardedDirectory ?? '' });
    const rvB = openLocalPeerRendezvous({ guardedDirectory: b.binding?.guardedDirectory ?? '' });

    const grantFromA = rvA.issueGrant('session_a');

    expect(rvB.redeem(grantFromA.nonce).admitted).toBe(false);
  });

  it('revoking at session exit closes the port for grants already handed out', () => {
    const admission = ensureRendezvousDirectory({ env: {}, home: () => scratch() });
    const rv = openLocalPeerRendezvous({
      guardedDirectory: admission.binding?.guardedDirectory ?? '',
    });
    const grant = rv.issueGrant('session_a');

    expect(rv.revokeAll()).toBe(1);
    expect(rv.redeem(grant.nonce).admitted).toBe(false);
  });
});
