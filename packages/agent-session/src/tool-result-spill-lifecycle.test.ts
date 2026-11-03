/**
 * What an embedder of the spill store sees around its lifetime: the earlier behaviour, unchanged,
 * when it passes no parent; no listener pile-up when it makes many stores; and nothing left behind
 * when its process is ended by a hangup rather than by `shutdown()`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeToolResultSpillStore } from './tool-result-spill-store.js';

const parents: string[] = [];

function parent(): string {
  const path = mkdtempSync(join(tmpdir(), 'agent-spill-lifecycle-'));
  parents.push(path);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of parents.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('a store built without a parent directory (the deprecated default)', () => {
  it('behaves as earlier releases did: a private directory under the operating-system temporary directory, removed at shutdown', async () => {
    const shared = parent();
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, shared);
    const listeners = {
      exit: process.listenerCount('exit'),
      hangup: process.listenerCount('SIGHUP'),
    };

    const store = new NodeToolResultSpillStore();
    const { reference } = await store.write('conversation content');

    const [name] = readdirSync(shared);
    expect(name).toMatch(/^agent-tool-results-[A-Za-z0-9]{6}$/u);
    const directory = join(shared, name!);
    const [file, ...others] = readdirSync(directory);
    expect(others).toEqual([]);
    expect(file).toMatch(/^[A-Za-z0-9_-]+\.txt$/u);
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(join(directory, file!)).mode & 0o777).toBe(0o600);
    }
    expect(await store.read(reference)).toBe('conversation content');
    expect({
      exit: process.listenerCount('exit'),
      hangup: process.listenerCount('SIGHUP'),
    }).toEqual(listeners);

    await store.shutdown();
    expect(readdirSync(shared)).toEqual([]);
  });
});

describe('many stores in one process', () => {
  it('share one exit listener, so an embedder making many gets no listener-leak warning', async () => {
    const root = parent();
    const before = process.listenerCount('exit');
    const warnings: string[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning.name);
    };
    process.on('warning', onWarning);
    try {
      const stores = Array.from(
        { length: 11 },
        () => new NodeToolResultSpillStore({ parentDirectory: root }),
      );

      expect(process.listenerCount('exit') - before).toBeLessThanOrEqual(1);
      await Promise.all(stores.map((store) => store.shutdown()));
      expect(process.listenerCount('exit')).toBe(before);
    } finally {
      process.off('warning', onWarning);
    }
    expect(warnings).not.toContain('MaxListenersExceededWarning');
    expect(readdirSync(root)).toEqual([]);
  });

  it('records the owning process inside each spill directory', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });

    const [name] = readdirSync(root);
    const record = JSON.parse(readFileSync(join(root, name!, '.owner.json'), 'utf8')) as {
      pid: number;
    };
    expect(record.pid).toBe(process.pid);
    await store.shutdown();
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('a shutdown that finds a file it did not write', () => {
  it('fails and keeps the owner record, so a later start can still sweep the directory', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const [name] = readdirSync(root);
    writeFileSync(join(root, name!, 'foreign.txt'), 'not the store');

    await expect(store.shutdown()).rejects.toMatchObject({ code: 'cleanup-failed' });

    expect(readdirSync(join(root, name!)).sort()).toEqual(['.owner.json', 'foreign.txt']);
  });
});

describe.skipIf(process.platform === 'win32')('a process ended by a hangup', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const storeModule = pathToFileURL(
    fileURLToPath(new URL('./tool-result-spill-store.ts', import.meta.url)),
  ).href;

  it('leaves no spilled result behind and still dies by the hangup', () => {
    const root = parent();
    const script = [
      `import { NodeToolResultSpillStore } from ${JSON.stringify(storeModule)};`,
      'const store = new NodeToolResultSpillStore({ parentDirectory: process.argv[1] });',
      "await store.write('conversation content');",
      "process.kill(process.pid, 'SIGHUP');",
      'setInterval(() => {}, 1000);',
    ].join('\n');

    const child = spawnSync(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(child.signal).toBe('SIGHUP');
    expect(readdirSync(root)).toEqual([]);
  }, 30_000);
});
