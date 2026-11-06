/**
 * Exclusive process markers, asserted against a real filesystem.
 *
 * Every simulated process gets its own identity, liveness probes and memory, so several processes
 * play out in one; the race cases stop one operation between its steps (`steps`) and run the others
 * there. The last cases run real Node processes with the default probes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProcessMarkerMemory, createProcessMarkers } from './process-marker.js';
import { readProcessOwnerRecordFile } from './process-owner-record.js';
import { leaveProcessMarker } from '../testing/process-marker-fixture.js';

import type { IProcessMarkersOptions } from './process-marker.js';
import type {
  IProcessIdentity,
  IProcessMarkerHandle,
  IProcessMarkers,
  TProcessMarkerAcquireResult,
} from '../interfaces/process-marker.js';

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
  root = join(realpathSync(mkdtempSync(join(tmpdir(), 'process-marker-'))), 'claims');
});

afterEach(() => {
  process.umask(previousUmask);
  rmSync(join(root, '..'), { recursive: true, force: true });
});

const mode = (path: string): number => statSync(path).mode & 0o7777;
const digestOf = (nonce: string): string => createHash('sha256').update(nonce).digest('hex');

function identity(pid: number): IProcessIdentity {
  return {
    pid,
    startTime: `started-${pid}`,
    bootId: 'boot-a',
    pidNamespace: 'pid:[4026531836]',
    hostname: 'host-a',
    machineId: 'machine-a',
  };
}

/** The pids that run in the simulated world; every one with the start time its identity records. */
const running = new Set<number>();

/** A test-only interprocess guard for the marker's short operations. */
const operationLock = {
  tryAcquire(name: string) {
    const path = join(root, `${name}.testguard`);
    try {
      mkdirSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
      throw error;
    }
    return { release: () => rmdirSync(path) };
  },
};

/** A simulated process: its own identity and memory, seeing the shared `running` set. */
function processAt(pid: number, extra: Partial<IProcessMarkersOptions> = {}): IProcessMarkers {
  running.add(pid);
  return createProcessMarkers(root, {
    operationLock,
    current: identity(pid),
    isProcessAlive: (other) => running.has(other),
    readStartTime: (other) => (running.has(other) ? `started-${other}` : undefined),
    memory: createProcessMarkerMemory(),
    lockWaitMs: 0,
    ...extra,
  });
}

beforeEach(() => running.clear());

function handleOf(
  result: TProcessMarkerAcquireResult | { readonly status: string },
): IProcessMarkerHandle {
  if (result.status !== 'acquired' || !('handle' in result)) {
    throw new Error(`expected acquired, got ${JSON.stringify(result)}`);
  }
  return result.handle;
}

const markerPath = (name: string): string => join(root, `${name}.owner`);
const recordAt = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(markerPath(name), 'utf8')) as Record<string, unknown>;

describe('publishing a marker', () => {
  it('distinguishes a new publication by the same process from the marker it replaced', () => {
    const first = processAt(5000);
    const oldHandle = handleOf(first.acquire('sess_a'));
    const oldBytes = readFileSync(markerPath('sess_a'));
    expect(first.remove('sess_a', { force: true }).status).toBe('removed');

    const next = processAt(5000);
    const newHandle = handleOf(next.acquire('sess_a'));
    expect(readFileSync(markerPath('sess_a'))).not.toEqual(oldBytes);
    expect(readProcessOwnerRecordFile(markerPath('sess_a'))).toEqual(identity(5000));
    expect(oldHandle.holds()).toBe(false);
    oldHandle.release();
    expect(newHandle.holds()).toBe(true);
    newHandle.release();
  });

  it('publishes an owner-only record naming this process in an owner-only directory', () => {
    const handle = handleOf(processAt(5000).acquire('sess_a'));

    expect(handle.holds()).toBe(true);
    expect(recordAt('sess_a')).toMatchObject({ pid: 5000, startTime: 'started-5000' });
    if (process.platform !== 'win32') {
      expect(mode(root)).toBe(0o700);
      expect(mode(markerPath('sess_a'))).toBe(0o600);
    }
    // Nothing but the marker is left: the temp file it was linked from is gone.
    expect(readdirSync(root)).toEqual(['sess_a.owner']);
  });

  it('refuses a second process while the first runs, naming it', () => {
    handleOf(processAt(5000).acquire('sess_a'));

    expect(processAt(6000).acquire('sess_a')).toEqual({
      status: 'held',
      holder: { owner: identity(5000), self: false, liveness: 'alive' },
    });
  });

  it('refuses while the owner cannot be told running: another machine, or a record that is not one', () => {
    leaveProcessMarker(root, 'sess_remote', { ...identity(9000), machineId: 'machine-b' });
    writeFileSync(markerPath('sess_garbage'), 'not a record', { mode: 0o600 });
    const other = processAt(6000);

    expect(other.acquire('sess_remote')).toMatchObject({
      status: 'held',
      holder: { self: false, liveness: 'unknown' },
    });
    expect(other.acquire('sess_garbage')).toEqual({
      status: 'held',
      holder: { self: false, liveness: 'unknown' },
    });
  });

  it('recognises its own marker from memory, where its record alone says unknown', () => {
    // No start time is read here (as on Windows), so a live owner is `unknown` by its record.
    const windows = (pid: number): IProcessMarkers => {
      running.add(pid);
      return createProcessMarkers(root, {
        operationLock,
        current: { pid, hostname: 'host-a' },
        isProcessAlive: (other) => running.has(other),
        readStartTime: () => undefined,
        memory: createProcessMarkerMemory(),
        lockWaitMs: 0,
      });
    };
    const here = windows(5000);
    handleOf(here.acquire('sess_a'));

    expect(here.acquire('sess_a')).toMatchObject({ status: 'held', holder: { self: true } });
    expect(here.inspect('sess_a')).toMatchObject({ holder: { self: true, liveness: 'alive' } });
    expect(windows(6000).inspect('sess_a')).toMatchObject({
      holder: { self: false, liveness: 'unknown' },
    });
  });

  it("breaks a gone owner's marker and publishes its own", () => {
    leaveProcessMarker(root, 'sess_a', identity(7000));

    const handle = handleOf(processAt(5000).acquire('sess_a'));

    expect(handle.holds()).toBe(true);
    expect(recordAt('sess_a')).toMatchObject({ pid: 5000 });
  });

  it('never reads a temp file a crash left behind as a marker', () => {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(`${markerPath('sess_a')}.4242.0123456789ab.tmp`, '{"pid":', { mode: 0o600 });
    const here = processAt(5000);

    expect(here.inspect('sess_a')).toEqual({ status: 'absent' });
    expect(handleOf(here.acquire('sess_a')).holds()).toBe(true);
  });

  it('leaves no marker when it fails before the link, nor a temp file when the link fails', () => {
    const crashed = processAt(5000, {
      steps: {
        publishing: () => {
          throw new Error('crash before the link');
        },
      },
    });
    expect(() => crashed.acquire('sess_a')).toThrow('crash before the link');
    expect(existsSync(markerPath('sess_a'))).toBe(false);

    const noLinks = processAt(5000, {
      linkFile: () => {
        throw Object.assign(new Error('no hard links here'), { code: 'EPERM' });
      },
    });
    expect(() => noLinks.acquire('sess_a')).toThrow('no hard links here');
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('releasing and removing', () => {
  it('releases only its own marker, idempotently', () => {
    const here = processAt(5000);
    const handle = handleOf(here.acquire('sess_a'));
    handle.release();
    handle.release();

    expect(here.inspect('sess_a')).toEqual({ status: 'absent' });
    expect(handle.holds()).toBe(false);

    const again = handleOf(here.acquire('sess_a'));
    running.delete(5000);
    const other = handleOf(processAt(6000).acquire('sess_a'));
    handle.release();
    again.release();
    expect(other.holds()).toBe(true);
  });

  it('removes only a gone marker unless forced', () => {
    const holder = handleOf(processAt(5000).acquire('sess_a'));
    leaveProcessMarker(root, 'sess_gone', identity(7000));
    const releaser = processAt(6000);

    expect(releaser.remove('sess_a')).toMatchObject({
      status: 'held',
      holder: { liveness: 'alive' },
    });
    expect(releaser.remove('sess_gone')).toMatchObject({
      status: 'removed',
      holder: { owner: { pid: 7000 }, liveness: 'gone' },
    });
    expect(releaser.remove('sess_gone')).toEqual({ status: 'absent' });
    expect(releaser.remove('sess_a', { force: true })).toMatchObject({ status: 'removed' });
    // The live writer lost its fence, and sees it before its next write.
    expect(holder.holds()).toBe(false);
  });
});

describe('leases', () => {
  const NONCE = 'nonce-for-the-child';

  it('hands a lent marker over only for the right nonce, keeping its digest', () => {
    const lender = handleOf(processAt(5000).acquire('sess_fork', { leaseDigest: digestOf(NONCE) }));
    const child = processAt(6000);

    expect(child.takeOver('sess_fork', 'a-wrong-nonce')).toMatchObject({
      status: 'held',
      holder: { owner: { pid: 5000 } },
    });
    expect(lender.holds()).toBe(true);

    const taken = handleOf(child.takeOver('sess_fork', NONCE));
    expect(taken.holds()).toBe(true);
    expect(lender.holds()).toBe(false);
    expect(recordAt('sess_fork')).toMatchObject({ pid: 6000, leaseDigest: digestOf(NONCE) });
  });

  it('refuses to take over a marker that carries no lease, and one that is gone', () => {
    handleOf(processAt(5000).acquire('sess_plain'));
    const child = processAt(6000);

    expect(child.takeOver('sess_plain', NONCE)).toMatchObject({ status: 'held' });
    expect(child.takeOver('sess_none', NONCE)).toEqual({ status: 'absent' });
  });

  it('ends a lease whoever holds it now, and nothing that does not carry it', () => {
    const lender = processAt(5000);
    handleOf(lender.acquire('sess_fork', { leaseDigest: digestOf(NONCE) }));
    const taken = handleOf(processAt(6000).takeOver('sess_fork', NONCE));

    expect(lender.endLease('sess_fork', digestOf('another'))).toBe(false);
    expect(taken.holds()).toBe(true);
    expect(lender.endLease('sess_fork', digestOf(NONCE))).toBe(true);
    expect(taken.holds()).toBe(false);
    expect(lender.inspect('sess_fork')).toEqual({ status: 'absent' });
    expect(lender.endLease('sess_fork', digestOf(NONCE))).toBe(false);
  });
});

describe('races between breakers, a live claimer and a lease end', () => {
  const NONCE = 'race-nonce';

  /** Every handle that still holds `name`. */
  const holding = (handles: readonly (IProcessMarkerHandle | undefined)[]): number =>
    handles.filter((handle) => handle?.holds() === true).length;

  it('does not take a break guard from a live process merely because it is old', () => {
    const writer = processAt(5000);
    handleOf(writer.acquire('sess_slow'));
    let now = Date.now();
    const second = processAt(6100, { now: () => now });
    let concurrent: unknown;
    const first = processAt(6000, {
      now: () => now,
      steps: {
        judged: () => {
          now += 11_000;
          concurrent = second.remove('sess_slow', { force: true });
        },
      },
    });
    expect(first.remove('sess_slow', { force: true })).toMatchObject({ status: 'removed' });
    expect(concurrent).toMatchObject({ status: 'busy' });
  });

  it('while one breaker holds the lock, the other breaker, the claimer and the lease end are refused', () => {
    // A lent marker whose child took it over and then died.
    const lender = processAt(5000);
    const lent = handleOf(lender.acquire('sess_fork', { leaseDigest: digestOf(NONCE) }));
    const child = handleOf(processAt(7000).takeOver('sess_fork', NONCE));
    running.delete(7000);

    const second = processAt(6100);
    const claimer = processAt(6200);
    const inside: Record<string, unknown> = {};
    const first = processAt(6000, {
      steps: {
        judged: () => {
          inside['second'] = second.acquire('sess_fork');
          inside['claimer'] = claimer.acquire('sess_fork');
          inside['leaseEnded'] = lender.endLease('sess_fork', digestOf(NONCE));
        },
      },
    });

    const won = handleOf(first.acquire('sess_fork'));

    expect(inside['second']).toMatchObject({ status: 'held' });
    expect(inside['claimer']).toMatchObject({ status: 'held' });
    expect(inside['leaseEnded']).toBe(false);
    expect(holding([lent, child, won])).toBe(1);
    expect(won.holds()).toBe(true);
  });

  it('a live claimer that publishes while the gone marker is aside wins, and the breaker is refused', () => {
    leaveProcessMarker(root, 'sess_a', identity(7000));
    const claimer = processAt(6200);
    let claimed: IProcessMarkerHandle | undefined;
    const breaker = processAt(6000, {
      steps: {
        movedAside: () => {
          claimed = handleOf(claimer.acquire('sess_a'));
        },
      },
    });

    expect(breaker.acquire('sess_a')).toMatchObject({
      status: 'held',
      holder: { owner: { pid: 6200 }, liveness: 'alive' },
    });
    expect(holding([claimed])).toBe(1);
  });

  it('does not let another breaker take a lock while its owner is still in the operation', () => {
    leaveProcessMarker(root, 'sess_a', identity(7000));
    let clock = 1_000_000_000_000;
    let late: TProcessMarkerAcquireResult | undefined;
    const breaker2 = processAt(6100, { now: () => clock + 11_000 });
    const breaker1 = processAt(6000, {
      now: () => clock,
      steps: {
        judged: () => {
          clock = Date.now();
          late = breaker2.acquire('sess_a');
        },
      },
    });
    const result = breaker1.acquire('sess_a');
    expect(late).toMatchObject({ status: 'held' });
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') result.handle.release();
  });

  it('a lease end during the take-over is refused, and a later one ends the child it went to', () => {
    const lender = processAt(5000);
    handleOf(lender.acquire('sess_fork', { leaseDigest: digestOf(NONCE) }));
    let ended: boolean | undefined;
    const child = processAt(6000, {
      steps: {
        judged: () => {
          ended = lender.endLease('sess_fork', digestOf(NONCE));
        },
      },
    });

    const taken = handleOf(child.takeOver('sess_fork', NONCE));

    expect(ended).toBe(false);
    expect(taken.holds()).toBe(true);
    expect(lender.endLease('sess_fork', digestOf(NONCE))).toBe(true);
    expect(taken.holds()).toBe(false);
  });

  it('a writer whose marker was broken by a process that judged it gone sees it no longer holds', () => {
    const writer = handleOf(processAt(5000).acquire('sess_a'));
    // A breaker whose probes say the writer's pid is gone (as a reused pid on Windows would).
    const breaker = createProcessMarkers(root, {
      operationLock,
      current: identity(6000),
      isProcessAlive: (pid) => pid === 6000,
      readStartTime: () => undefined,
      memory: createProcessMarkerMemory(),
      lockWaitMs: 0,
    });

    const won = handleOf(breaker.acquire('sess_a'));

    expect(writer.holds()).toBe(false);
    expect(won.holds()).toBe(true);
  });

  it('removes a break lock whose owner is gone before breaking', () => {
    leaveProcessMarker(root, 'sess_a', identity(7000));
    writeFileSync(join(root, 'sess_a.break'), JSON.stringify(identity(7100)), { mode: 0o600 });

    expect(handleOf(processAt(5000).acquire('sess_a')).holds()).toBe(true);
    expect(existsSync(join(root, 'sess_a.break'))).toBe(false);
  });
});

describe('markers held by real processes, with the default probes', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const moduleUrl = pathToFileURL(
    fileURLToPath(new URL('./process-marker.ts', import.meta.url)),
  ).href;
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  /** A real process that acquires `name`, reports the result, and, when it acquired, stays alive until killed. */
  async function acquireIn(
    name: string,
  ): Promise<{ child: ChildProcess; result: TProcessMarkerAcquireResult }> {
    const script = [
      `import { createProcessMarkers } from ${JSON.stringify(moduleUrl)};`,
      `import { mkdirSync, rmdirSync } from 'node:fs';`,
      `import { join } from 'node:path';`,
      `const operationLock = { tryAcquire(name) { const path = join(process.argv[1], name + '.testguard'); try { mkdirSync(path); } catch (e) { if (e.code === 'EEXIST') return; throw e; } return { release() { rmdirSync(path); } }; } };`,
      `const result = createProcessMarkers(process.argv[1], { operationLock }).acquire(${JSON.stringify(name)});`,
      "process.stdout.write(JSON.stringify(result.status === 'acquired' ? { status: 'acquired' } : result) + '\\n');",
      "if (result.status === 'acquired') setInterval(() => {}, 1000); else process.exit(0);",
    ].join('\n');
    const child = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    children.push(child);
    const line = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.includes('\n')) resolve(out.trim());
      });
      child.once('exit', (code, signal) => {
        if (!out.includes('\n')) reject(new Error(`child ended (${code}, ${signal})`));
      });
    });
    return { child, result: JSON.parse(line) as TProcessMarkerAcquireResult };
  }

  it('refuses a second process while this one holds the marker', async () => {
    const handle = handleOf(createProcessMarkers(root, { operationLock }).acquire('sess_real'));
    try {
      const { result } = await acquireIn('sess_real');
      expect(result).toMatchObject({ status: 'held', holder: { owner: { pid: process.pid } } });
    } finally {
      handle.release();
    }
  }, 60_000);

  it('refuses while a holder process runs, and acquires once it has exited', async () => {
    const holder = await acquireIn('sess_real');
    expect(holder.result).toEqual({ status: 'acquired' });

    const refused = await acquireIn('sess_real');
    expect(refused.result).toMatchObject({
      status: 'held',
      holder: { owner: { pid: holder.child.pid }, self: false },
    });

    const ended = new Promise((resolve) => holder.child.once('exit', resolve));
    holder.child.kill('SIGKILL');
    await ended;

    const after = await acquireIn('sess_real');
    expect(after.result).toEqual({ status: 'acquired' });
  }, 60_000);
});
