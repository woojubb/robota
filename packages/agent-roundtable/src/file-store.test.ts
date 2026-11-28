import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConversationStore, FileStoreCorruptionError } from './node';
import { runConversationStoreConformance, runDurableConversationStoreConformance } from './testing';
import type { ConversationStoreConformanceFixture } from './testing';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roundtable-file-store-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Two instances over one directory: separate caches, as two processes would have. */
function fixture() {
  let now = 1_000;
  let root: string;
  const open = () => new FileConversationStore({ root, now: () => now });
  return async (): Promise<
    ConversationStoreConformanceFixture & { restart(): FileConversationStore }
  > => {
    root = await tempRoot();
    return {
      clients: [open(), open()],
      restart: open,
      leaseMs: 1_000,
      advanceTo: (time) => {
        now = Math.max(now, time);
      },
      cleanup: async () => {
        await rm(root, { recursive: true, force: true });
      },
    };
  };
}

describe('FileConversationStore conformance', () => {
  it('passes the backend checks', async () => {
    const make = fixture();
    await runConversationStoreConformance(() => make());
  });

  it('passes the durable checks across restarted instances', async () => {
    const make = fixture();
    await runDurableConversationStoreConformance(() => make());
  });
});

describe('FileConversationStore layout and validation', () => {
  async function seeded() {
    const root = await tempRoot();
    let now = 1_000;
    const store = new FileConversationStore({ root, now: () => now });
    await store.create('room/é', { step: 0 });
    const claim = await store.claim('room/é', 'owner', 10_000);
    await store.commit({ claim, expectedRevision: 0, operationId: 'one', state: { step: 1 } });
    const directory = join(root, Buffer.from('room/é', 'utf8').toString('hex'));
    return {
      root,
      store,
      claim,
      directory,
      advance: (to: number) => (now = to),
      reopen: () => new FileConversationStore({ root, now: () => now }),
    };
  }

  it('names a conversation directory by the hex of its id and keeps every revision', async () => {
    const { directory } = await seeded();
    expect((await readdir(directory)).sort()).toEqual(['claims', 'revisions']);
    expect((await readdir(join(directory, 'revisions'))).sort()).toEqual(['0.json', '1.json']);
  });

  it.skipIf(process.platform === 'win32')('creates owner-only directories and files', async () => {
    const { root, directory } = await seeded();
    for (const path of [root, directory, join(directory, 'revisions')]) {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
    }
    for (const path of [
      join(directory, 'claims', '1.json'),
      join(directory, 'revisions', '1.json'),
    ]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects ids that cannot be a directory name', async () => {
    const store = new FileConversationStore({ root: await tempRoot() });
    for (const id of ['', 'x'.repeat(121), '\ud800']) {
      await expect(store.create(id, null)).rejects.toMatchObject({ code: 'invalid-config' });
      await expect(store.load(id)).rejects.toMatchObject({ code: 'invalid-config' });
    }
    await expect(store.create('x'.repeat(120), null)).resolves.toMatchObject({ revision: 0 });
  });

  it('completes a create that stopped before revision 0 was published', async () => {
    const root = await tempRoot();
    const hex = Buffer.from('half', 'utf8').toString('hex');
    await mkdir(join(root, hex, 'revisions'), { recursive: true });
    const store = new FileConversationStore({ root });
    expect(await store.load('half')).toBeUndefined();
    await expect(store.create('half', 'ok')).resolves.toMatchObject({ revision: 0, state: 'ok' });
  });

  it('refuses a revision file whose content is damaged', async () => {
    const { directory, reopen } = await seeded();
    await writeFile(join(directory, 'revisions', '1.json'), '{"schemaVersion":1');
    await expect(reopen().load('room/é')).rejects.toBeInstanceOf(FileStoreCorruptionError);
  });

  it('refuses a revision file whose fingerprint does not match its state', async () => {
    const { directory, reopen } = await seeded();
    const path = join(directory, 'revisions', '1.json');
    const record = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
    record.state = { step: 'tampered' };
    await writeFile(path, JSON.stringify(record));
    await expect(reopen().load('room/é')).rejects.toBeInstanceOf(FileStoreCorruptionError);
  });

  it('refuses a gap in the revision numbers and an unknown file', async () => {
    const { directory, reopen } = await seeded();
    const revisions = join(directory, 'revisions');
    await writeFile(join(revisions, 'stray.txt'), 'x');
    await expect(reopen().load('room/é')).rejects.toBeInstanceOf(FileStoreCorruptionError);
    await rm(join(revisions, 'stray.txt'));
    await rm(join(revisions, '0.json'));
    await expect(reopen().load('room/é')).rejects.toBeInstanceOf(FileStoreCorruptionError);
  });

  it('refuses a damaged claim record instead of resetting the fence', async () => {
    const { directory, reopen } = await seeded();
    await writeFile(
      join(directory, 'claims', '1.json'),
      '{"schemaVersion":1,"generation":1,"fence":-1,"claim":null}',
    );
    await expect(reopen().claim('room/é', 'next', 1_000)).rejects.toBeInstanceOf(
      FileStoreCorruptionError,
    );
  });
});

describe('FileConversationStore claim generations', () => {
  /** Instances over one directory whose claim writes can be held at a barrier. */
  async function racers(count: number) {
    const root = await tempRoot();
    let now = 1_000;
    const holds: Array<((point: string) => Promise<void> | void) | undefined> = [];
    const open = (index: number) =>
      new FileConversationStore({
        root,
        now: () => now,
        checkpoint: (point) => holds[index]?.(point),
      });
    const stores = Array.from({ length: count }, (_, i) => open(i));
    return {
      root,
      stores,
      holds,
      open,
      advance: (to: number) => (now = to),
      now: () => now,
    };
  }

  it('lets exactly one of six racing instances win each generation and never reissues a fence', async () => {
    const r = await racers(6);
    await r.stores[0].create('room', null);
    const dead = await r.stores[0].claim('room', 'dead', 1_000);
    expect(dead.fence).toBe(1);
    const fences: number[] = [dead.fence];
    for (let round = 0; round < 3; round++) {
      r.advance(r.now() + 10_000);
      // Every racer reads the same generation and stops after syncing its record, so all six
      // contend for one name.
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      r.stores.forEach((_, i) => {
        r.holds[i] = async (point) => {
          if (point !== 'claim-synced') return;
          if (++arrived === r.stores.length) release();
          await gate;
        };
      });
      const results = await Promise.allSettled(
        r.stores.map((store, i) => store.claim('room', `racer-${i}`, 5_000)),
      );
      const won = results.filter((x) => x.status === 'fulfilled');
      expect(won).toHaveLength(1);
      for (const x of results) {
        if (x.status === 'rejected') expect(x.reason).toMatchObject({ code: 'busy' });
      }
      fences.push((won[0] as PromiseFulfilledResult<{ fence: number }>).value.fence);
    }
    expect(fences).toEqual([1, 2, 3, 4]);
    const hex = Buffer.from('room', 'utf8').toString('hex');
    expect(await readdir(join(r.root, hex, 'claims'))).toHaveLength(1);
  });

  it('withdraws a generation a stalled writer links below a newer one', async () => {
    const r = await racers(2);
    const [stalled, other] = r.stores;
    await other.create('room', null);
    await other.claim('room', 'dead', 1_000);
    r.advance(r.now() + 10_000);
    let reached!: () => void;
    const atBarrier = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    r.holds[0] = async (point) => {
      if (point !== 'claim-synced') return;
      reached();
      await gate;
    };
    const late = stalled.claim('room', 'late', 5_000).then(
      () => 'won',
      (error: { code: string }) => error.code,
    );
    await atBarrier;
    r.holds[0] = undefined;
    // While the first writer is stalled with generation 2 ready, another owner takes generation 2,
    // renews twice, and the earlier generations are pruned.
    const owner = await other.claim('room', 'owner', 60_000);
    await other.renew(owner, 60_000);
    await other.renew(owner, 60_000);
    resume();
    expect(await late).toBe('busy');
    await expect(other.renew(owner, 60_000)).resolves.toMatchObject({ fence: owner.fence });
    const hex = Buffer.from('room', 'utf8').toString('hex');
    expect(await readdir(join(r.root, hex, 'claims'))).toEqual(['5.json']);
  });

  it('reports a release that took effect as done when a newer owner has already moved on', async () => {
    const r = await racers(2);
    const [releasing, other] = r.stores;
    await other.create('room', null);
    const claim = await other.claim('room', 'first', 60_000);
    let reached!: () => void;
    const atBarrier = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    r.holds[0] = async (point) => {
      if (point !== 'claim-linked') return;
      reached();
      await gate;
    };
    const release = releasing.release(claim);
    await atBarrier;
    r.holds[0] = undefined;
    // The release is linked but not yet verified; the next owner takes the conversation.
    const next = await other.claim('room', 'second', 60_000);
    resume();
    await expect(release).resolves.toBeUndefined();
    await expect(other.renew(next, 60_000)).resolves.toMatchObject({ fence: next.fence });
  });
});

describe('FileConversationStore retried commit', () => {
  it('returns the receipt when the same operation lands from another instance mid-commit', async () => {
    const root = await tempRoot();
    const now = () => 1_000;
    const a = new FileConversationStore({ root, now });
    let landOnce: (() => Promise<unknown>) | undefined;
    const b = new FileConversationStore({
      root,
      now,
      checkpoint: async (point) => {
        const land = landOnce;
        if (point === 'temp-write' && land) {
          landOnce = undefined;
          await land();
        }
      },
    });
    await a.create('room', { step: 0 });
    const claim = await a.claim('room', 'owner', 60_000);
    const change = { claim, expectedRevision: 0, operationId: 'x', state: { step: 1 } };
    let landed: unknown;
    landOnce = async () => (landed = await a.commit(change));
    const received = await b.commit(change);
    expect(received).toEqual(landed);
    expect(received.revision).toBe(1);
    expect(await b.load('room')).toMatchObject({ revision: 1 });
  });
});
