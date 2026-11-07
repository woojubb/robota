import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, it } from 'vitest';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { fixtureKeyring } from './helpers.js';

it('does not admit a second update while a slow live writer holds the lock', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-concurrent-update-')));
  const path = join(root, 'secure', 'keyring.json');
  const { keyring } = await fixtureKeyring();
  createKeyringFileStore({ root, path }).create(keyring);
  const source = pathToFileURL(join(process.cwd(), '../agent-local-host/src/index.ts')).href;
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: root,
    USERPROFILE: root,
    PRODUCT_USER_STATE_DIR: root,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const common = `import { createKeyringFileStore } from ${JSON.stringify(source)};
    const root = process.argv[1]; const path = process.argv[2];
    const options = { root, path, lockStaleAfterMs: 25 };`;
  const slow = `${common}
    import { readSync, writeSync, fsyncSync } from 'node:fs';
    const store = createKeyringFileStore({ ...options, durability: { syncFile(fd) {
      writeSync(3, 'ready'); readSync(0, Buffer.alloc(1), 0, 1, null); fsyncSync(fd);
    } } });
    const current = store.load(); if (current.status !== 'present') process.exit(2);
    try { store.save({ ...current.keyring, slots: [...current.keyring.slots].reverse() }, current.keyring); }
    catch (error) { process.stderr.write(String(error.code)); process.exitCode = 3; }`;
  const contender = `${common}
    const store = createKeyringFileStore(options);
    const current = store.load(); if (current.status !== 'present') process.exit(2);
    try { store.save({ ...current.keyring, slots: [...current.keyring.slots].reverse() }, current.keyring); process.stdout.write('saved'); }
    catch (error) { process.stdout.write(String(error.code)); }`;
  const child = spawn(
    process.execPath,
    ['--import', tsx, '--conditions=source', '--input-type=module', '-e', slow, root, path],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
  );
  const completion = once(child, 'close', { signal: AbortSignal.timeout(10_000) });
  let outcome = '';
  let exitCode: number | null = null;
  try {
    const readyPipe = child.stdio[3];
    if (!readyPipe || !('on' in readyPipe)) throw new Error('Missing readiness pipe.');
    await once(readyPipe, 'data', { signal: AbortSignal.timeout(10_000) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = spawnSync(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', contender, root, path],
      { cwd: root, env, encoding: 'utf8', timeout: 10_000 },
    );
    if (second.error || second.status !== 0)
      throw new Error(`Contending fixture failed: ${second.error?.message ?? second.stderr}`);
    outcome = second.stdout;
  } finally {
    child.stdin?.end('x');
    try {
      [exitCode] = await completion;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  expect(outcome).toBe('busy');
  expect(exitCode).toBe(0);
}, 20_000);

it('recovers a keyring update after a process holding the guard is terminated', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-process-exit-')));
  const path = join(root, 'secure', 'keyring.json');
  const { keyring } = await fixtureKeyring();
  const store = createKeyringFileStore({ root, path });
  store.create(keyring);
  const source = pathToFileURL(join(process.cwd(), '../agent-local-host/src/index.ts')).href;
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const program = `import { createKeyringFileStore } from ${JSON.stringify(source)};
    import { readSync, writeSync } from 'node:fs';
    const root = process.argv[1]; const path = process.argv[2];
    const store = createKeyringFileStore({ root, path, durability: { syncFile() {
      writeSync(3, 'ready'); readSync(0, Buffer.alloc(1), 0, 1, null);
    } } });
    const current = store.load(); if (current.status !== 'present') process.exit(2);
    store.save({ ...current.keyring, slots: [...current.keyring.slots].reverse() }, current.keyring);`;
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: root,
    USERPROFILE: root,
    PRODUCT_USER_STATE_DIR: root,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const child = spawn(
    process.execPath,
    ['--import', tsx, '--conditions=source', '--input-type=module', '-e', program, root, path],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
  );
  const completion = once(child, 'close', { signal: AbortSignal.timeout(10_000) });
  try {
    const ready = child.stdio[3];
    if (!ready || !('on' in ready)) throw new Error('Missing readiness pipe.');
    await once(ready, 'data', { signal: AbortSignal.timeout(10_000) });
    child.kill('SIGKILL');
    await completion;
    const changed = { ...keyring, slots: [...keyring.slots].reverse() };
    store.save(changed, keyring);
    expect(store.load()).toEqual({ status: 'present', keyring: changed });
    expect(readdirSync(join(root, 'secure')).sort()).toEqual(['keyring.guard', 'keyring.json']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
