/**
 * One writer per session across store instances and processes: every claim and lend holds the id's
 * writer marker in `claims/` beside the records, every write of the id holds it, and a second opener
 * is refused with `has_writer`, naming the process that holds it.
 */

import { createProcessOperationLock } from '@robota-sdk/agent-node-lock';

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createProcessMarkers,
  readCurrentProcessIdentity,
  readProcessStartTime,
} from '@robota-sdk/agent-core/node';
import {
  createTestArtifactSealer,
  goneProcessOwner,
  leaveProcessMarker,
} from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'writer-marker-')));
}

function record(id: string, text = 'hello'): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

const plain = (dir: string): NodeSessionStore => new NodeSessionStore(dir, { sealing: 'plain' });
const claimsOf = (dir: string): string => path.join(dir, 'claims');
const fileOf = (dir: string, id: string): string => path.join(dir, `${id}.json`);

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** A live process other than this one: the one that started this test worker. */
function liveOtherProcess() {
  const startTime = readProcessStartTime(process.ppid);
  const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
  return startTime === undefined
    ? { ...here, pid: process.ppid }
    : { ...here, pid: process.ppid, startTime };
}

describe('a session claimed by one store instance', () => {
  it('is refused to a second instance over the same files, naming this process', () => {
    const dir = newStoreDir();
    const first = plain(dir);
    const second = plain(dir);
    const claim = first.claim('sess_a', { fresh: true });

    const refusal = thrownBy(() => second.claim('sess_a'));

    expect(refusal).toMatchObject({
      code: 'SESSION_CLAIMED',
      sessionId: 'sess_a',
      reason: 'has_writer',
      holder: { pid: process.pid, self: true },
      // A session of this store that has not let go: the one refusal a caller may wait out.
      closing: true,
    });
    expect(second.hasWriter('sess_a')).toBe(true);
    claim.release();
    expect(second.hasWriter('sess_a')).toBe(false);
    expect(() => second.claim('sess_a').release()).not.toThrow();
  });

  it('keeps its marker in an owner-only claims directory that listings ignore', () => {
    const dir = newStoreDir();
    const store = plain(dir);
    const claim = store.claim('sess_a', { fresh: true });
    store.save(record('sess_a'), { claim });

    expect(readdirSync(claimsOf(dir)).sort()).toEqual(['sess_a.guard', 'sess_a.owner']);
    if (process.platform !== 'win32') expect(statSync(claimsOf(dir)).mode & 0o777).toBe(0o700);
    expect(store.list().map((entry) => entry.id)).toEqual(['sess_a']);
    claim.release();
    expect(readdirSync(claimsOf(dir))).toEqual(['sess_a.guard']);
  });

  it('refuses every other write of the id while it runs: a save, a delete and an adopt', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const first = new NodeSessionStore(dir, { sealing: { sealer } });
    const claim = first.claim('sess_a', { fresh: true });
    first.save(record('sess_a'), { claim, provenance: 'owner' });
    const before = readFileSync(fileOf(dir, 'sess_a'));
    const second = new NodeSessionStore(dir, { sealing: { sealer } });

    expect(thrownBy(() => second.save(record('sess_a', 'other')))).toMatchObject({
      reason: 'has_writer',
    });
    expect(thrownBy(() => second.delete('sess_a'))).toMatchObject({ reason: 'has_writer' });
    const digest = createHash('sha256').update(before).digest('hex');
    expect(second.authorship?.adopt('sess_a', digest)).toBe('has_writer');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });

  it('has its next save refused as released, never written, once its marker was broken', () => {
    const dir = newStoreDir();
    const store = plain(dir);
    const claim = store.claim('sess_a', { fresh: true });
    store.save(record('sess_a', 'first'), { claim });
    expect(
      createProcessMarkers(claimsOf(dir), {
        operationLock: createProcessOperationLock(claimsOf(dir)),
      }).remove('sess_a', { force: true }),
    ).toMatchObject({
      status: 'removed',
    });
    const before = readFileSync(fileOf(dir, 'sess_a'), 'utf8');

    expect(thrownBy(() => store.save(record('sess_a', 'second'), { claim }))).toMatchObject({
      code: 'SESSION_CLAIMED',
      reason: 'released',
    });
    expect(readFileSync(fileOf(dir, 'sess_a'), 'utf8')).toBe(before);
  });

  it('is still copied by a read that takes no marker', () => {
    const dir = newStoreDir();
    const first = plain(dir);
    const claim = first.claim('sess_a', { fresh: true });
    first.save(record('sess_a', 'saved'), { claim });

    const copy = plain(dir).claim('sess_a', { copy: true });

    expect(copy.outcome).toMatchObject({ status: 'valid', record: { id: 'sess_a' } });
    copy.release();
    expect(first.hasWriter('sess_a')).toBe(true);
  });
});

describe('a writer marker another process left', () => {
  it('stands while its owner runs, and names it with the release command', () => {
    const dir = newStoreDir();
    const other = liveOtherProcess();
    leaveProcessMarker(claimsOf(dir), 'sess_a', other);
    const store = new NodeSessionStore(dir, {
      sealing: 'plain',
      releaseCommand: (id) => `robota session release ${id} --force`,
    });

    const refusal = thrownBy(() => store.claim('sess_a')) as Error;

    expect(refusal).toMatchObject({
      reason: 'has_writer',
      holder: { pid: other.pid, self: false },
    });
    expect(refusal.message).toContain(`pid ${other.pid}`);
    expect(refusal.message).toContain('robota session release sess_a --force');
    expect(store.hasWriter('sess_a')).toBe(true);
  });

  it('is broken once its owner is gone, and is no writer before that', () => {
    const dir = newStoreDir();
    leaveProcessMarker(claimsOf(dir), 'sess_a', goneProcessOwner());
    const store = plain(dir);

    expect(store.hasWriter('sess_a')).toBe(false);
    const claim = store.claim('sess_a', { fresh: true });
    expect(
      JSON.parse(readFileSync(path.join(claimsOf(dir), 'sess_a.owner'), 'utf8')),
    ).toMatchObject({
      pid: process.pid,
    });
    claim.release();
  });
});

describe('lending a session to another process', () => {
  it('counts the id as written here until the lease ends: claims are refused and hasWriter is true', () => {
    const dir = newStoreDir();
    const parent = plain(dir);
    const lease = parent.lend('sess_fork');

    expect(parent.hasWriter('sess_fork')).toBe(true);
    expect(thrownBy(() => parent.claim('sess_fork'))).toMatchObject({ reason: 'has_writer' });
    expect(thrownBy(() => plain(dir).claim('sess_fork'))).toMatchObject({ reason: 'has_writer' });
    lease.end();
    lease.end();
    expect(parent.hasWriter('sess_fork')).toBe(false);
    expect(existsSync(path.join(claimsOf(dir), 'sess_fork.owner'))).toBe(false);
  });

  it('refuses the lent id as a subagent holding it, and names the child once it took the marker over', () => {
    const dir = newStoreDir();
    const parent = plain(dir);
    const lease = parent.lend('sess_fork');

    // The child has not taken the marker over yet: only the lend shows who will write.
    const starting = thrownBy(() => parent.claim('sess_fork')) as Error;
    expect(starting).toMatchObject({
      reason: 'has_writer',
      closing: false,
      holder: { self: true, lent: true },
    });
    expect(starting.message).toContain('subagent this process started');

    // The child took it over: the refusal names the child, which is not this process.
    const child = liveOtherProcess();
    leaveProcessMarker(
      claimsOf(dir),
      'sess_fork',
      child,
      createHash('sha256').update(lease.nonce).digest('hex'),
    );
    const running = thrownBy(() => parent.claim('sess_fork')) as Error;
    expect(running).toMatchObject({
      reason: 'has_writer',
      closing: false,
      holder: { pid: child.pid, self: false, lent: true },
    });
    expect(running.message).toContain(`pid ${child.pid}`);
    expect(running.message).toContain('subagent this process started');

    // A write of the lent id is refused in the same words.
    const rename = thrownBy(() => parent.save(record('sess_fork'))) as Error;
    expect(rename).toMatchObject({ reason: 'has_writer', closing: false });
    expect(rename.message).toContain(`pid ${child.pid}`);
    const removal = thrownBy(() => parent.delete('sess_fork')) as Error;
    expect(removal).toMatchObject({ reason: 'has_writer', closing: false });
    expect(removal.message).toContain(`pid ${child.pid}`);
    lease.end();
  });

  it('hands the marker over only for the right nonce, and the end removes it from the child too', () => {
    const dir = newStoreDir();
    const parent = plain(dir);
    parent.save(record('sess_fork'));
    const lease = parent.lend('sess_fork');
    const child = plain(dir);

    expect(thrownBy(() => child.claim('sess_fork', { lease: 'not-the-nonce' }))).toMatchObject({
      reason: 'has_writer',
    });
    const claim = child.claim('sess_fork', { lease: lease.nonce });
    expect(claim.outcome).toMatchObject({ status: 'valid' });
    child.save(record('sess_fork', 'the child wrote'), { claim });

    lease.end();

    expect(parent.hasWriter('sess_fork')).toBe(false);
    expect(thrownBy(() => child.save(record('sess_fork', 'late'), { claim }))).toMatchObject({
      reason: 'released',
    });
    claim.release();
  });

  it('lends in a store that seals as well', () => {
    const dir = newStoreDir();
    const parent = new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } });
    const lease = parent.lend('sess_fork');

    expect(lease.nonce).toMatch(/^[0-9a-f]{64}$/u);
    expect(parent.hasWriter('sess_fork')).toBe(true);
    lease.end();
    expect(parent.hasWriter('sess_fork')).toBe(false);
  });
});

describe('the unlock-time tag of a pending raise', () => {
  it('is dropped while another process holds the marker, leaving the record unverified', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_closed'), { provenance: 'owner' });
    const planted = leaveProcessMarker(claimsOf(dir), 'sess_closed', liveOtherProcess());
    const before = readFileSync(fileOf(dir, 'sess_closed'));

    sealer.unlock();

    expect(readFileSync(fileOf(dir, 'sess_closed')).equals(before)).toBe(true);
    createProcessMarkers(claimsOf(dir), {
      operationLock: createProcessOperationLock(claimsOf(dir)),
    }).remove('sess_closed', { force: true });
    expect(existsSync(planted)).toBe(false);
    const fresh = new NodeSessionStore(dir, { sealing: { sealer } }).load('sess_closed');
    expect(fresh).toMatchObject({ status: 'valid', authorship: 'unverified' });
  });
});

describe('two real processes on one session', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const storeUrl = pathToFileURL(
    fileURLToPath(new URL('../session-store.ts', import.meta.url)),
  ).href;
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  /** A real process that claims `id` in the store at `dir`, reports, and stays alive while it holds the claim. */
  async function claimIn(
    dir: string,
    id: string,
  ): Promise<{ child: ChildProcess; report: Record<string, unknown> }> {
    const script = [
      `import { NodeSessionStore } from ${JSON.stringify(storeUrl)};`,
      "const store = new NodeSessionStore(process.argv[1], { sealing: 'plain' });",
      'try {',
      `  store.claim(${JSON.stringify(id)}, { fresh: true });`,
      "  process.stdout.write(JSON.stringify({ claimed: true }) + '\\n');",
      '  setInterval(() => {}, 1000);',
      '} catch (error) {',
      "  process.stdout.write(JSON.stringify({ claimed: false, reason: error.reason, holder: error.holder }) + '\\n');",
      '  process.exit(0);',
      '}',
    ].join('\n');
    const child = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, dir],
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
    return { child, report: JSON.parse(line) as Record<string, unknown> };
  }

  it('refuses the second process, naming the first, and takes it once the first has exited', async () => {
    const dir = newStoreDir();
    const holder = await claimIn(dir, 'sess_shared');
    expect(holder.report).toEqual({ claimed: true });

    const store = plain(dir);
    expect(thrownBy(() => store.claim('sess_shared'))).toMatchObject({
      reason: 'has_writer',
      holder: { pid: holder.child.pid, self: false },
    });

    const ended = new Promise((resolve) => holder.child.once('exit', resolve));
    holder.child.kill('SIGKILL');
    await ended;

    const claim = store.claim('sess_shared');
    claim.release();
  }, 60_000);

  it('refuses a second process while this one holds the claim', async () => {
    const dir = newStoreDir();
    const claim = plain(dir).claim('sess_shared', { fresh: true });
    try {
      const { report } = await claimIn(dir, 'sess_shared');
      expect(report).toMatchObject({
        claimed: false,
        reason: 'has_writer',
        holder: { pid: process.pid, self: false },
      });
    } finally {
      claim.release();
    }
  }, 60_000);
});
