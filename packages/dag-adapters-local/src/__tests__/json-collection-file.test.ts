import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hydrateCollection, persistCollection } from '../json-collection-file.js';

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
  const dir = mkdtempSync(path.join(tmpdir(), 'json-collection-'));
  dirs.push(dir);
  return path.join(dir, 'c.json');
}

describe('persistCollection', () => {
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
    const dir = mkdtempSync(path.join(tmpdir(), 'json-collection-'));
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
