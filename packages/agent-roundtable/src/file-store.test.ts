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
  const open = () => new FileConversationStore({ root, now: () => now, lockWaitMs: 5_000 });
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
    const store = new FileConversationStore({ root, now: () => now, lockWaitMs: 300 });
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
      reopen: () => new FileConversationStore({ root, now: () => now, lockWaitMs: 300 }),
    };
  }

  it('names a conversation directory by the hex of its id and keeps every revision', async () => {
    const { directory } = await seeded();
    expect((await readdir(directory)).sort()).toEqual(['claim.json', 'revisions']);
    expect((await readdir(join(directory, 'revisions'))).sort()).toEqual(['0.json', '1.json']);
  });

  it.skipIf(process.platform === 'win32')('creates owner-only directories and files', async () => {
    const { root, directory } = await seeded();
    for (const path of [root, directory, join(directory, 'revisions')]) {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
    }
    for (const path of [join(directory, 'claim.json'), join(directory, 'revisions', '1.json')]) {
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
    await writeFile(join(directory, 'claim.json'), '{"schemaVersion":1,"fence":-1,"claim":null}');
    await expect(reopen().claim('room/é', 'next', 1_000)).rejects.toBeInstanceOf(
      FileStoreCorruptionError,
    );
  });

  it('waits for a live lock holder, then reports busy', async () => {
    const { directory, reopen } = await seeded();
    const live = { pid: process.pid, host: (await import('node:os')).hostname(), token: 't' };
    await writeFile(
      join(directory, 'claim.lock'),
      JSON.stringify({ ...live, expiresAt: Date.now() + 60_000 }),
    );
    await expect(reopen().claim('room/é', 'next', 1_000)).rejects.toMatchObject({ code: 'busy' });
  });

  it('breaks a lock whose expiry passed even when its process is alive', async () => {
    const { directory, advance, reopen } = await seeded();
    const live = { pid: process.pid, host: (await import('node:os')).hostname(), token: 't' };
    await writeFile(
      join(directory, 'claim.lock'),
      JSON.stringify({ ...live, expiresAt: Date.now() - 1 }),
    );
    advance(1_000_000);
    await expect(reopen().claim('room/é', 'next', 1_000)).resolves.toMatchObject({ fence: 2 });
  });
});
