import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodePluginTextFileStore } from '../node-text-file-store';

describe('NodePluginTextFileStore', () => {
  let dir: string;
  const store = new NodePluginTextFileStore();

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-text-store-')));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as undefined', async () => {
    expect(await store.readText(join(dir, 'missing.txt'))).toBeUndefined();
  });

  it('reads back what it wrote, creating missing parent directories', async () => {
    const file = join(dir, 'a', 'b', 'data.json');
    await store.writeText(file, '{"é€":1}');
    expect(readFileSync(file, 'utf8')).toBe('{"é€":1}');
    expect(await store.readText(file)).toBe('{"é€":1}');
  });

  it('replaces the text on a second write', async () => {
    const file = join(dir, 'data.txt');
    await store.writeText(file, 'first');
    await store.writeText(file, 'second');
    expect(await store.readText(file)).toBe('second');
  });

  it('appends, creating the file and its parent directories', async () => {
    const file = join(dir, 'logs', 'app.log');
    await store.appendText(file, 'one\n');
    await store.appendText(file, 'two\n');
    expect(readFileSync(file, 'utf8')).toBe('one\ntwo\n');
  });

  it('rethrows a read failure that is not a missing file', async () => {
    // A directory where a file is expected: EISDIR, not ENOENT.
    writeFileSync(join(dir, 'file'), 'x');
    await expect(store.readText(dir)).rejects.toThrow();
  });
});
