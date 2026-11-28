import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConversationStore } from './node';
import type { FileStoreCheckpoint } from './node';
import type { ConversationClaim } from './store-types';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = join(packageRoot, 'src', 'file-store-crash-child.ts');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A store with one conversation at revision 1 and a long-lived claim, all acknowledged. */
async function acknowledged() {
  const root = await mkdtemp(join(tmpdir(), 'roundtable-crash-'));
  roots.push(root);
  const store = new FileConversationStore({ root, lockWaitMs: 2_000 });
  await store.create('room', { step: 0 });
  const claim = await store.claim('room', 'parent', 600_000);
  await store.commit({ claim, expectedRevision: 0, operationId: 'one', state: { step: 1 } });
  return { root, claim };
}

function reopen(root: string, now: () => number = Date.now) {
  return new FileConversationStore({ root, now, lockWaitMs: 2_000 });
}

function run(
  root: string,
  operation: 'commit' | 'renew' | 'claim',
  killAt: FileStoreCheckpoint | '',
  claim?: ConversationClaim,
) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', child], {
    cwd: packageRoot,
    env: {
      ...process.env,
      STORE_ROOT: root,
      STORE_OPERATION: operation,
      STORE_KILL_AT: killAt,
      STORE_CLAIM: JSON.stringify(claim ?? null),
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    signal: result.signal,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function names(root: string, ...path: string[]): Promise<string[]> {
  const hex = Buffer.from('room', 'utf8').toString('hex');
  return (await readdir(join(root, hex, ...path))).sort();
}

describe('FileConversationStore after a real process kill', () => {
  it('lets the child finish when nothing kills it', async () => {
    const { root, claim } = await acknowledged();
    const done = run(root, 'commit', '', claim);
    expect(done.status, done.stderr).toBe(0);
    expect(await reopen(root).load('room')).toMatchObject({ revision: 2, state: { step: 2 } });
  });

  it.each<FileStoreCheckpoint>(['temp-write', 'temp-synced'])(
    'a commit killed at %s leaves no revision and a clean retry',
    async (point) => {
      const { root, claim } = await acknowledged();
      expect(run(root, 'commit', point, claim).signal).toBe('SIGKILL');
      const store = reopen(root);
      expect(await store.load('room')).toMatchObject({ revision: 1, state: { step: 1 } });
      expect(await store.lookupOperation('room', 'victim')).toBeUndefined();
      expect(await store.lookupOperation('room', 'one')).toMatchObject({ revision: 1 });
      expect(await names(root, 'revisions')).toEqual(['0.json', '1.json']);
      const retried = await store.commit({
        claim,
        expectedRevision: 1,
        operationId: 'victim',
        state: { step: 2 },
      });
      expect(retried.revision).toBe(2);
    },
  );

  it('a commit killed after the link is found once, by load and by receipt', async () => {
    const { root, claim } = await acknowledged();
    expect(run(root, 'commit', 'linked', claim).signal).toBe('SIGKILL');
    const store = reopen(root);
    expect(await store.load('room')).toMatchObject({ revision: 2, state: { step: 2 } });
    const receipt = await store.lookupOperation('room', 'victim');
    expect(receipt).toMatchObject({ revision: 2 });
    const retried = await store.commit({
      claim,
      expectedRevision: 1,
      operationId: 'victim',
      state: { step: 2 },
    });
    expect(retried).toEqual(receipt);
    expect(await names(root, 'revisions')).toEqual(['0.json', '1.json', '2.json']);
  });

  it.each<FileStoreCheckpoint>(['claim-write', 'claim-synced'])(
    'a renewal killed at %s leaves the old claim intact and parseable',
    async (point) => {
      const { root, claim } = await acknowledged();
      expect(run(root, 'renew', point, claim).signal).toBe('SIGKILL');
      const store = reopen(root);
      const renewed = await store.renew(claim, 1_000);
      expect(renewed.fence).toBe(claim.fence);
      expect(await names(root)).toEqual(['claim.json', 'revisions']);
    },
  );

  it.each<[FileStoreCheckpoint, number]>([
    ['claim-write', 2],
    ['claim-synced', 2],
    ['claim-renamed', 3],
  ])('a claim killed at %s never has its fence issued twice', async (point, nextFence) => {
    const { root, claim } = await acknowledged();
    await reopen(root).release(claim);
    expect(run(root, 'claim', point).signal).toBe('SIGKILL');
    let now = Date.now();
    const store = reopen(root, () => now);
    if (point === 'claim-renamed') {
      // The child's claim reached disk with fence 2, so it is still owned until its lease ends.
      await expect(store.claim('room', 'parent', 1_000)).rejects.toMatchObject({ code: 'busy' });
      now += 200_000;
    }
    const next = await store.claim('room', 'parent', 1_000);
    expect(next.fence).toBe(nextFence);
    expect(await names(root)).toEqual(['claim.json', 'revisions']);
  });

  it.each<['claim' | 'commit']>([['claim'], ['commit']])(
    'a %s killed while holding the lock does not wedge the store',
    async (operation) => {
      const { root, claim } = await acknowledged();
      if (operation === 'claim') await reopen(root).release(claim);
      expect(run(root, operation, 'lock-held', claim).signal).toBe('SIGKILL');
      expect(await names(root)).toContain('claim.lock');
      const store = reopen(root);
      if (operation === 'commit') {
        const committed = await store.commit({
          claim,
          expectedRevision: 1,
          operationId: 'after',
          state: { step: 2 },
        });
        expect(committed.revision).toBe(2);
      } else {
        expect((await store.claim('room', 'parent', 1_000)).fence).toBe(2);
      }
      expect(await names(root)).not.toContain('claim.lock');
    },
  );
});
