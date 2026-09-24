import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  announcePeer,
  listPeers,
  listReachablePeers,
  readDarwinStartTime,
  readProcessStartTime,
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-reg-')));
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
  it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
    'recognizes this running process with the platform default start-time reader',
    async () => {
      // macOS reports a birth second, so wait until this process can safely certify it.
      if (process.platform === 'darwin') {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 1_100 - process.uptime() * 1_000)),
        );
      }
      const guardedDirectory = scratch();
      announcePeer({ guardedDirectory }, { sessionId: 'self', pid: process.pid });

      expect(listPeers({ guardedDirectory })[0]?.liveness).toBe('alive');
      expect(listReachablePeers({ guardedDirectory }).map((peer) => peer.sessionId)).toEqual([
        'self',
      ]);
    },
  );

  it('exercises the Darwin reader and platform selection on every CI host', () => {
    const birth = 'Wed Sep 23 13:40:17 2026';
    expect(readDarwinStartTime(123, (pid) => (pid === 123 ? `${birth}\n` : ''))).toBe(birth);
    expect(readProcessStartTime(123, 'darwin', () => birth)).toBe(birth);
    expect(
      readDarwinStartTime(123, () => {
        throw new Error('ps unavailable');
      }),
    ).toBeUndefined();
  });

  it('a pid that is gone is dead', () => {
    const guardedDirectory = scratch();
    announcePeer(
      { guardedDirectory, readStartTime: starts({ 100: 'T1' }) },
      { sessionId: 'session_a', pid: 100 },
    );

    const [found] = listPeers({
      guardedDirectory,
      readStartTime: starts({}),
      probePid: () => 'absent',
    });

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

  it('reports an inspection failure as unknown while the process still exists', () => {
    const guardedDirectory = scratch();
    announcePeer(
      { guardedDirectory, readStartTime: starts({ 100: 'T1' }) },
      { sessionId: 'session_a', pid: 100 },
    );

    const [found] = listPeers({
      guardedDirectory,
      readStartTime: () => undefined,
      probePid: () => 'present',
    });
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

describe('#2726 — peer activity is evidence, not liveness', () => {
  it('shows only a fresh, valid observation from a confirmed live process', () => {
    const guardedDirectory = scratch();
    let now = 1_000;
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }), now: () => now };
    announcePeer(opts, { sessionId: 'working', pid: 100, status: 'working' });
    expect(listPeers(opts)[0]?.status).toBe('working');
    now += 30_001;
    expect(listPeers(opts)[0]?.status).toBe('unknown');
    expect(listPeers({ ...opts, readStartTime: () => undefined })[0]?.status).toBe('unknown');
  });

  it('rejects forged or malformed activity metadata', () => {
    const guardedDirectory = scratch();
    const opts = { guardedDirectory, readStartTime: starts({ 100: 'T1' }), now: () => 100 };
    announcePeer(opts, { sessionId: 'bad', pid: 100 });
    const file = join(guardedDirectory, 'bad.peer.json');
    const entry = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      file,
      JSON.stringify({ ...entry, status: 'secret transcript', statusObservedAt: 100 }),
    );
    expect(listPeers(opts)[0]?.status).toBe('unknown');
    writeFileSync(file, JSON.stringify({ ...entry, status: 'idle', statusObservedAt: 101 }));
    expect(listPeers(opts)[0]?.status).toBe('unknown');
  });
});
