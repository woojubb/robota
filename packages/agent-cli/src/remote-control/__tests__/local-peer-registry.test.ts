import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  announcePeer,
  listPeers,
  listReachablePeers,
  withdrawPeer,
} from '../local-peer-registry.js';

/**
 * #1863 — discovery over the guarded rendezvous.
 *
 * The directory's permissions do the security work; these tests are about the part that is NOT
 * security: telling a live session from a file a crashed one left behind.
 */
const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'robota-reg-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A start-time reader whose answers the test controls. */
function starts(map: Record<number, string | undefined>) {
  return (pid: number): string | undefined => map[pid];
}

describe('#1863 — announcing and withdrawing', () => {
  it('publishes an entry a peer can read back', () => {
    const guardedDirectory = scratch();
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }), now: () => 5 };

    announcePeer(opts, { sessionId: 'session_a', name: 'alice', pid: 100 });

    const [found] = listPeers(opts);
    expect(found?.entry.sessionId).toBe('session_a');
    expect(found?.entry.name).toBe('alice');
    expect(found?.liveness).toBe('alive');
  });

  it('writes the entry owner-only', () => {
    const guardedDirectory = scratch();
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }) };

    announcePeer(opts, { sessionId: 'session_a', pid: 100 });

    const file = readdirSync(guardedDirectory)[0];
    expect(statSync(join(guardedDirectory, file)).mode & 0o777).toBe(0o600);
  });

  it('leaves no temporary file behind — a reader must never see a partial entry', () => {
    const guardedDirectory = scratch();
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }) };

    announcePeer(opts, { sessionId: 'session_a', pid: 100 });

    expect(readdirSync(guardedDirectory).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('withdrawing removes it, and withdrawing again is not an error', () => {
    const guardedDirectory = scratch();
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }) };
    announcePeer(opts, { sessionId: 'session_a', pid: 100 });

    withdrawPeer(opts, 'session_a');
    withdrawPeer(opts, 'session_a');

    expect(listPeers(opts)).toEqual([]);
  });
});

describe('#1863 — telling a live session from a crashed one', () => {
  it('a pid that is gone is dead', () => {
    const guardedDirectory = scratch();
    announcePeer(
      { guardedDirectory, readStartTime: starts({ 100: 'T1' }) },
      { sessionId: 'session_a', pid: 100 },
    );

    const [found] = listPeers({ guardedDirectory, readStartTime: starts({}) });

    expect(found?.liveness).toBe('dead');
  });

  it('A RECYCLED PID IS DEAD, NOT ALIVE — the case a pid check alone gets wrong', () => {
    // The dangerous direction: without the start time, an unrelated process that happened to
    // inherit the pid would be treated as the peer that crashed.
    const guardedDirectory = scratch();
    announcePeer(
      { guardedDirectory, readStartTime: starts({ 100: 'T1' }) },
      { sessionId: 'session_a', pid: 100 },
    );

    const [found] = listPeers({ guardedDirectory, readStartTime: starts({ 100: 'T2' }) });

    expect(found?.liveness).toBe('dead');
  });

  it('a platform that cannot answer reports unknown, not alive and not dead', () => {
    // Collapsing "could not tell" into either verdict is how a non-Linux host reports every peer as
    // dead, or how a peer that is gone gets offered as a destination.
    const guardedDirectory = scratch();
    announcePeer(
      { guardedDirectory, readStartTime: starts({}) },
      { sessionId: 'session_a', pid: 100 },
    );

    const [found] = listPeers({ guardedDirectory, readStartTime: starts({}) });

    expect(found?.liveness).toBe('unknown');
  });

  it('only alive peers are offered as destinations', () => {
    // An `unknown` peer must not be addressable: the message would be delivered to nothing while
    // the sender holds an ack for it.
    const guardedDirectory = scratch();
    const known = { guardedDirectory, readStartTime: starts({ 100: 'T1' }) };
    announcePeer(known, { sessionId: 'live', pid: 100 });
    announcePeer({ guardedDirectory, readStartTime: starts({}) }, { sessionId: 'murky', pid: 200 });

    const reachable = listReachablePeers(known).map((e) => e.sessionId);

    expect(reachable).toEqual(['live']);
  });
});

describe('#1863 — a malformed entry is not a peer', () => {
  it('skips unparseable and shape-invalid files rather than surfacing them', () => {
    const guardedDirectory = scratch();
    writeFileSync(join(guardedDirectory, 'broken.peer.json'), '{not json', 'utf8');
    writeFileSync(join(guardedDirectory, 'shapeless.peer.json'), '{"sessionId":1}', 'utf8');
    writeFileSync(join(guardedDirectory, 'unrelated.txt'), 'x', 'utf8');

    expect(listPeers({ guardedDirectory, readStartTime: starts({}) })).toEqual([]);
  });
});
