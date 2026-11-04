/**
 * #3679 step 3e: the parent vouches for a fork record its write-only child saved — exactly the bytes
 * the child last reported, only once the child has both exited and disconnected, and only when the
 * job started from the owner's content and no save was refused. The child side reports each save of
 * its fork record and remembers a refused one.
 *
 * The child here is a stand-in emitter, so the order of `message`, `exit` and `disconnect` is the
 * test's to choose — Node delivers buffered messages before `disconnect`, but `exit` can come first.
 * The parent store is a real sealing store over the agent-core sealer double.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  followForkRecordSaves,
  reportRecordSaves,
} from '../child-process-subagent-record-saves.js';
import { isSubagentWorkerChildMessage } from '../child-process-subagent-ipc.js';

import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type { TResumeSessionStore } from '../index.js';
import type { TCountersignOutcome } from '../child-process-subagent-record-saves.js';
import type { ChildProcess } from 'node:child_process';

type IInteractiveSessionRecord = Parameters<TResumeSessionStore['save']>[0];

const FORK_ID = 'session_fork_countersign';
const DIGEST = 'a'.repeat(64);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A sessions directory inside a fresh root, which the store may tighten as it owns it. */
function directory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-saves-')));
  roots.push(root);
  return join(root, 'sessions');
}

function forkRecord(text: string): IInteractiveSessionRecord {
  return {
    id: FORK_ID,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

/** A child process as far as the parent's listener sees it: an emitter with a channel. */
class FakeChild extends EventEmitter {
  connected = true;
  pid: number | undefined = 4242;
  report(sha256: string): void {
    this.emit('message', { type: 'record_saved', sessionId: FORK_ID, sha256 });
  }
  end(): void {
    this.emit('exit', 0, null);
    this.connected = false;
    this.emit('disconnect');
  }
}

/** A sealing parent that wrote the fork record for a handoff, and a write-only child that saved it. */
function forkedParent(options: { readonly locked?: boolean } = {}) {
  const dir = directory();
  const sealer: IArtifactSealerDouble = createTestArtifactSealer();
  const parent = createUserSessionStore(dir, { sealing: { sealer } });
  parent.save(forkRecord('the parent conversation'), { handoff: true, provenance: 'owner' });
  const child = createUserSessionStore(dir, {
    sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
  });
  child.importHeld?.(FORK_ID, parent.exportHeld?.(FORK_ID) as string);
  child.save(forkRecord('the child turn'));
  if (options.locked === true) sealer.lock();
  const digestOnDisk = (): string =>
    createHash('sha256')
      .update(readFileSync(join(dir, `${FORK_ID}.json`)))
      .digest('hex');
  const seenFresh = (): unknown => {
    sealer.unlock();
    const outcome = createUserSessionStore(dir, { sealing: { sealer } }).load(FORK_ID);
    return outcome.status === 'valid' ? outcome.authorship : outcome.status;
  };
  return { dir, sealer, parent, child, digestOnDisk, seenFresh };
}

function follow(
  child: FakeChild,
  store: Parameters<typeof followForkRecordSaves>[1]['store'],
  startedOwner = true,
): TCountersignOutcome[] {
  const settled: TCountersignOutcome[] = [];
  followForkRecordSaves(child as unknown as ChildProcess, {
    sessionId: FORK_ID,
    startedOwner,
    store,
    onSettled: (outcome) => settled.push(outcome),
  });
  return settled;
}

describe('the record_saved message', () => {
  it('is a child message of exactly three members', () => {
    const message = { type: 'record_saved', sessionId: FORK_ID, sha256: DIGEST };

    expect(isSubagentWorkerChildMessage(message)).toBe(true);
    for (const bad of [
      { ...message, extra: 1 },
      { ...message, clean: true },
      { ...message, sha256: 'A'.repeat(64) },
      { ...message, sha256: 'a'.repeat(63) },
      { ...message, sessionId: '' },
      { type: 'record_saved', sessionId: FORK_ID },
    ]) {
      expect(isSubagentWorkerChildMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is never vouched for when malformed', () => {
    const { parent, digestOnDisk, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.emit('message', {
      type: 'record_saved',
      sessionId: FORK_ID,
      sha256: digestOnDisk(),
      extra: 'not a member',
    });
    child.end();

    expect(settled).toEqual(['not-vouched']);
    expect(seenFresh()).toBe('unverified');
  });
});

describe('the parent’s countersign of a fork job', () => {
  it('raises the bytes the job last reported, once the child exited and disconnected', () => {
    const { parent, digestOnDisk, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.report(digestOnDisk());
    child.emit('exit', 0, null);
    expect(settled).toEqual([]);
    child.connected = false;
    child.emit('disconnect');

    expect(settled).toEqual(['adopted']);
    expect(seenFresh()).toBe('verified');
  });

  it('counts a report the child sent after its result', () => {
    const { parent, digestOnDisk, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.report(DIGEST);
    child.emit('message', { type: 'result', output: 'done' });
    child.report(digestOnDisk());
    child.end();

    expect(settled).toEqual(['adopted']);
    expect(seenFresh()).toBe('verified');
  });

  it('waits for the last message when the exit comes first', () => {
    const { parent, digestOnDisk, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.report(DIGEST);
    child.emit('exit', 0, null);
    child.report(digestOnDisk());
    child.connected = false;
    child.emit('disconnect');

    expect(settled).toEqual(['adopted']);
    expect(seenFresh()).toBe('verified');
  });

  it('raises nothing for a refused save, or a job not started from the owner’s content', () => {
    {
      const { parent, digestOnDisk, seenFresh } = forkedParent();
      const child = new FakeChild();
      const settled = follow(child, parent);
      child.report(digestOnDisk());
      child.emit('message', { type: 'error', message: 'x', recordSaveRefused: true });
      child.end();
      expect(settled).toEqual(['not-vouched']);
      expect(seenFresh()).toBe('unverified');
    }
    const { parent, digestOnDisk, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent, false);
    child.report(digestOnDisk());
    child.end();
    expect(settled).toEqual(['not-vouched']);
    expect(seenFresh()).toBe('unverified');
  });

  it('raises nothing when the file is no longer the bytes reported', () => {
    const { parent, seenFresh } = forkedParent();
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.report(DIGEST);
    child.end();

    expect(settled).toEqual(['changed']);
    expect(seenFresh()).toBe('unverified');
  });

  it('defers the raise while the keys are locked, and the unlock settles it', () => {
    const { parent, sealer, digestOnDisk, dir } = forkedParent({ locked: true });
    const child = new FakeChild();
    const settled = follow(child, parent);

    child.report(digestOnDisk());
    child.end();
    expect(settled).toEqual(['pending']);
    const lockedOutcome = createUserSessionStore(dir, { sealing: { sealer } }).load(FORK_ID);
    expect(lockedOutcome.status).toBe('locked');

    sealer.unlock();

    const outcome = createUserSessionStore(dir, { sealing: { sealer } }).load(FORK_ID);
    expect(outcome.status === 'valid' && outcome.authorship).toBe('verified');
  });

  it('decides only once, and raises nothing for a child that reported no save', () => {
    const calls: string[] = [];
    const authorship = {
      adopt: vi.fn((id: string, digest: string) => {
        calls.push(`adopt:${id}:${digest}`);
        return 'adopted' as const;
      }),
      heldDigest: vi.fn(),
      onUnlock: vi.fn(() => () => undefined),
    };
    const store = { authorship };
    const child = new FakeChild();
    follow(child, store);
    child.report(DIGEST);
    child.end();
    child.end();

    expect(calls).toEqual([`adopt:${FORK_ID}:${DIGEST}`]);

    const silent = new FakeChild();
    const quiet = {
      adopt: vi.fn(),
      heldDigest: vi.fn(),
      onUnlock: vi.fn(() => () => undefined),
    };
    follow(silent, { authorship: quiet });
    silent.end();
    expect(quiet.adopt).not.toHaveBeenCalled();
  });

  it('settles a child that never started, which sends neither exit nor disconnect', () => {
    const authorship = {
      adopt: vi.fn(),
      heldDigest: vi.fn(),
      onUnlock: vi.fn(() => () => undefined),
    };
    const child = new FakeChild();
    child.pid = undefined;
    const settled = follow(child, { authorship });

    child.emit('error', new Error('spawn ENOENT'));

    expect(settled).toEqual(['not-vouched']);
    expect(authorship.adopt).not.toHaveBeenCalled();
  });
});

describe('a child’s reports of its fork record', () => {
  function childStore() {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const parent = createUserSessionStore(dir, { sealing: { sealer } });
    parent.save(forkRecord('the parent conversation'), { handoff: true, provenance: 'owner' });
    const store = createUserSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    store.importHeld?.(FORK_ID, parent.exportHeld?.(FORK_ID) as string);
    return { dir, sealer, store };
  }

  it('names the stored bytes of each save of the fork record, and nothing else', () => {
    const { dir, store } = childStore();
    const sent: unknown[] = [];
    const reporter = reportRecordSaves(store, FORK_ID, (message) => sent.push(message));

    reporter.store.save(forkRecord('the child turn'));
    reporter.store.save({ ...forkRecord('another'), id: 'session_other' });

    const digest = createHash('sha256')
      .update(readFileSync(join(dir, `${FORK_ID}.json`)))
      .digest('hex');
    expect(sent).toEqual([{ type: 'record_saved', sessionId: FORK_ID, sha256: digest }]);
    expect(reporter.refused()).toBe(false);
  });

  it('remembers a save refused because the file changed under it', () => {
    const { dir, sealer, store } = childStore();
    const sent: unknown[] = [];
    const reporter = reportRecordSaves(store, FORK_ID, (message) => sent.push(message));
    createUserSessionStore(dir, { sealing: { sealer } }).save(forkRecord('planted'));
    // The restore's own read finding the file changed fails the job by itself; it is no refused save.
    reporter.store.load(FORK_ID, { hold: true });
    expect(reporter.refused()).toBe(false);
    reporter.restored();

    const read = reporter.store.load(FORK_ID, { hold: true });
    const held = reporter.store.loadHeld?.(FORK_ID);
    expect(() => reporter.store.save(forkRecord('the child turn'))).toThrow(/changed on disk/);

    expect(read).toEqual({ status: 'locked', reason: 'changed' });
    expect(held).toEqual({ status: 'locked', reason: 'changed' });
    expect(reporter.refused()).toBe(true);
    expect(sent).toEqual([]);
  });
});
