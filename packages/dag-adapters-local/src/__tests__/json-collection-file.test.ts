import { mkdtempSync, readFileSync, rmSync, statSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createCollectionPersister,
  drainQueue,
  hydrateCollection,
  persistCollection,
} from '../json-collection-file.js';

/**
 * DAG-003, review round 2 — the ordering hole the first version left.
 *
 * `persistCollection` captured its snapshot synchronously and wrote asynchronously with no ordering
 * between calls, so two concurrent mutations could have their renames land out of call order and the
 * file regress to a stale snapshot while the Maps stayed correct. Demonstrated outside the suite by
 * delaying one write: an older `["a"]` overwrote `["a","b","c"]`.
 *
 * Concurrency is not hypothetical here — `dag-worker`'s own suite drives concurrent calls into one
 * storage instance via `Promise.all`.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function collectionFile(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'json-collection-')));
  dirs.push(dir);
  return path.join(dir, 'c.json');
}

describe('persistCollection', () => {
  it('TC-01 keeps a successor queued at owner release pending until it is durable', async () => {
    const file = collectionFile();
    let releaseFinalWrite!: () => void;
    const finalWrite = new Promise<void>((resolve) => {
      releaseFinalWrite = resolve;
    });
    let observeBoundary!: () => void;
    const boundaryObserved = new Promise<void>((resolve) => {
      observeBoundary = resolve;
    });
    let successor: Promise<void> | undefined;
    let idleObservations = 0;
    let writes = 0;

    const persist = createCollectionPersister(
      async (_filePath, serialized) => {
        writes += 1;
        if (writes === 2) await finalWrite;
        await writeFile(file, serialized, 'utf-8');
      },
      {
        beforeOwnerRelease: () => {
          idleObservations += 1;
          if (idleObservations === 1) {
            successor = persist(file, [{ id: 'successor' }]);
            observeBoundary();
          }
        },
      },
    );

    let initialSettled = false;
    const initial = persist(file, [{ id: 'initial' }]).finally(() => {
      initialSettled = true;
    });

    await boundaryObserved;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(initialSettled).toBe(false);
    expect(successor).toBeDefined();

    releaseFinalWrite();
    await Promise.all([initial, successor]);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual([{ id: 'successor' }]);
  });

  it('TC-02 keeps different file owners independent', async () => {
    let releaseFirstPath!: () => void;
    const firstPathWrite = new Promise<void>((resolve) => {
      releaseFirstPath = resolve;
    });
    const persistedPaths: string[] = [];
    const persist = createCollectionPersister(async (filePath) => {
      persistedPaths.push(filePath);
      if (filePath === '/virtual/first.json') await firstPathWrite;
    });

    let firstSettled = false;
    const first = persist('/virtual/first.json', [{ id: 'first' }]).finally(() => {
      firstSettled = true;
    });
    await persist('/virtual/second.json', [{ id: 'second' }]);

    expect(firstSettled).toBe(false);
    expect(persistedPaths).toEqual(['/virtual/first.json', '/virtual/second.json']);
    releaseFirstPath();
    await first;
  });

  it('the FINAL state wins after concurrent writes', async () => {
    const file = collectionFile();
    const live = new Map<string, { id: string }>();

    // Every call publishes the same live Map, which is how the port uses it: the writer should
    // publish whatever it holds when the write begins, not when the call was made.
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        live.set(`k${i}`, { id: `k${i}` });
        return persistCollection(file, live.values());
      }),
    );

    const onDisk = JSON.parse(readFileSync(file, 'utf-8')) as unknown[];
    expect(onDisk).toHaveLength(live.size);
  });

  it('a later write is never overtaken by an earlier one', async () => {
    // The specific regression: with unordered renames the first call's smaller snapshot could land
    // last. Distinct snapshots make that observable rather than merely counted.
    const file = collectionFile();
    const first = persistCollection(file, [{ id: 'old' }]);
    const second = persistCollection(file, [{ id: 'old' }, { id: 'new' }]);
    await Promise.all([first, second]);

    const onDisk = JSON.parse(readFileSync(file, 'utf-8')) as Array<{ id: string }>;
    expect(onDisk.map((entry) => entry.id)).toEqual(['old', 'new']);
  });

  it('round-trips through hydrateCollection', async () => {
    const file = collectionFile();
    await persistCollection(file, [{ id: 'a' }, { id: 'b' }]);

    const into = new Map<string, { id: string }>();
    await hydrateCollection(file, into, (value) => value.id);
    expect([...into.keys()]).toEqual(['a', 'b']);
  });

  it('a missing file hydrates as empty rather than throwing', async () => {
    const into = new Map<string, { id: string }>();
    await hydrateCollection(collectionFile(), into, (value) => value.id);
    expect(into.size).toBe(0);
  });

  it('an unreadable file THROWS rather than reading as empty', async () => {
    // Treating a real read failure as "nothing was stored" would discard exactly the state this
    // module exists to keep — the defect DAG-003 is about, one level down.
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'json-collection-')));
    dirs.push(dir);
    const into = new Map<string, { id: string }>();
    // A directory is not a file: reading it fails with EISDIR, not ENOENT.
    await expect(hydrateCollection(dir, into, (value) => value.id)).rejects.toThrow();
  });
});

describe('file permissions', () => {
  it('writes owner-only, not the process umask', async () => {
    // Task runs carry `inputSnapshot`/`outputSnapshot` payloads and `storageRoot` can resolve under
    // `XDG_DATA_HOME`. This package already pins `cost-meta.json` to 0600 for the same reason
    // (SEC-003 / CWE-377); the run-state files were inheriting the umask.
    const file = collectionFile();
    await persistCollection(file, [{ id: 'a' }]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

/**
 * Review round 6 — the failure SIGNAL, not the data.
 *
 * The first coalescing loop abandoned the queue on the first failure, so a late write failing
 * rejected for callers whose own state had already landed, and whatever was still queued stayed
 * unwritten until some later unrelated mutation called in again. Draining fully fixes both, and makes
 * the verdict mean something: only a stale disk rejects.
 */
describe('drainQueue', () => {
  const FILE = '/does/not/matter';

  function queueOf(...states: string[]): Map<string, () => string> {
    const queue = new Map<string, () => string>();
    let next = 0;
    // One entry per key by design — the coalescing cache holds only the latest. `states` is consumed
    // in order as the loop re-queues.
    queue.set(FILE, () => states[next++] ?? 'last');
    return queue;
  }

  it('TC-03 a later SUCCESS supersedes an earlier failure', async () => {
    // Disk ends current, so nobody should be told their write failed.
    const queue = queueOf('s1', 's2');
    let calls = 0;
    const write = async (_path: string, serialized: string): Promise<void> => {
      calls += 1;
      if (calls === 1) {
        queue.set(FILE, () => 's2');
        throw new Error('transient');
      }
      expect(serialized).toBe('s2');
    };

    await expect(drainQueue(FILE, queue, write)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('TC-03 a failure of the FINAL attempt rejects — disk is stale', async () => {
    const queue = queueOf('s1');
    const write = async (): Promise<void> => {
      throw new Error('persistent');
    };
    await expect(drainQueue(FILE, queue, write)).rejects.toThrow(/persistent/);
  });

  it('keeps draining what is queued rather than stopping at a failure', async () => {
    const queue = queueOf('s1');
    const seen: string[] = [];
    let calls = 0;
    const write = async (_path: string, serialized: string): Promise<void> => {
      seen.push(serialized);
      calls += 1;
      if (calls === 1) {
        queue.set(FILE, () => 's2');
        throw new Error('transient');
      }
      if (calls === 2) queue.set(FILE, () => 's3');
    };

    await drainQueue(FILE, queue, write);
    expect(seen).toEqual(['s1', 's2', 's3']);
  });

  it('an empty queue is a no-op, not a write', async () => {
    let called = false;
    await drainQueue(FILE, new Map(), async () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});
