import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { createProcessOperationLock } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROKER_LOCK_NAME,
  BROKER_SOCKET_NAME,
  brokerNamespaceName,
  claimBrokerNamespaceDirectory,
} from '../workspace-root-broker-directory.js';
import {
  ensureWorkspaceRootBroker,
  removeStaleBrokerDirectories,
} from '../workspace-root-broker-process.js';
import { requestWorkspaceRootBroker, startWorkspaceRootBroker } from '../workspace-root-broker.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

// Both wrappers run the real function unless a test hands one call a replacement.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('../workspace-root-broker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspace-root-broker.js')>();
  return { ...actual, requestWorkspaceRootBroker: vi.fn(actual.requestWorkspaceRootBroker) };
});

const owner = process.getuid?.() ?? -1;
const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

// A Unix socket path is limited to about 100 bytes, which the platform temp directory on macOS exceeds.
function fixture() {
  const parent = mkdtempSync('/tmp/rbd-');
  roots.push(parent);
  return parent;
}

/** A namespace directory name of this user; `seed` is one hex digit repeated to the hash length. */
function namespaceName(seed: string, uid = owner): string {
  return `robota-root-${uid}-${seed.repeat(24)}`;
}

function makeDirectory(parent: string, name: string): string {
  const directory = join(parent, name);
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

function age(path: string): void {
  const longAgo = new Date(Date.now() - 60 * 60 * 1_000);
  utimesSync(path, longAgo, longAgo);
}

/** What a broker that was killed leaves behind: a released guard file and its socket file. */
function leaveCrashedBroker(directory: string): void {
  createProcessOperationLock(directory).tryAcquire(BROKER_LOCK_NAME)?.release();
  const killed = spawnSync(process.execPath, [
    '-e',
    "require('node:net').createServer().listen(process.argv[1], () => process.kill(process.pid, 'SIGKILL'))",
    join(directory, BROKER_SOCKET_NAME),
  ]);
  expect(killed.signal).toBe('SIGKILL');
  age(directory);
}

/** Runs `during` while a sweep waits for the directory's socket to answer, then reports that nothing does. */
function duringNextPing(during: () => void): void {
  vi.mocked(requestWorkspaceRootBroker).mockImplementationOnce(async () => {
    during();
    throw new Error('No broker answers.');
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('a broker leaves no directory behind', () => {
  const stopped = (endpoint: string) =>
    vi.waitFor(
      () => expect(requestWorkspaceRootBroker(endpoint, { op: 'ping' })).rejects.toThrow(),
      { timeout: 10_000, interval: 100 },
    );

  it('removes its directory once its user-state root is gone', async () => {
    const parent = fixture();
    const directory = makeDirectory(parent, namespaceName('a'));
    const state = join(parent, 'state');
    servers.push(
      await startWorkspaceRootBroker(
        join(directory, BROKER_SOCKET_NAME),
        directory,
        join(state, 'workspace-trust.json'),
      ),
    );
    expect(existsSync(join(directory, `${BROKER_LOCK_NAME}.guard`))).toBe(true);

    rmSync(state, { recursive: true, force: true });
    await vi.waitFor(() => expect(existsSync(directory)).toBe(false), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it('keeps its directory when it is closed while its user-state root remains', async () => {
    const parent = fixture();
    const directory = makeDirectory(parent, namespaceName('a'));
    const broker = await startWorkspaceRootBroker(
      join(directory, BROKER_SOCKET_NAME),
      directory,
      join(parent, 'state', 'workspace-trust.json'),
    );
    await broker.close();
    expect(existsSync(directory)).toBe(true);
  });

  it('never removes a lock directory that is not a broker namespace directory', async () => {
    const parent = fixture();
    const directory = makeDirectory(parent, 'private');
    const state = join(parent, 'state');
    const endpoint = join(directory, BROKER_SOCKET_NAME);
    servers.push(
      await startWorkspaceRootBroker(endpoint, directory, join(state, 'workspace-trust.json')),
    );

    rmSync(state, { recursive: true, force: true });
    await stopped(endpoint);
    expect(existsSync(directory)).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')(
  'a start removes the directories of brokers that are gone',
  () => {
    it('removes a directory whose broker was killed', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      leaveCrashedBroker(directory);

      expect(await removeStaleBrokerDirectories({ parent })).toBe(1);
      expect(existsSync(directory)).toBe(false);
    });

    it('keeps the directory of a live broker', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      const endpoint = join(directory, BROKER_SOCKET_NAME);
      servers.push(await startWorkspaceRootBroker(endpoint));
      age(directory);

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      expect(existsSync(directory)).toBe(true);
      expect(await requestWorkspaceRootBroker(endpoint, { op: 'ping' })).toMatchObject({
        status: 'ready',
      });
    });

    it('keeps a directory whose guard is held although no socket answers', () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      const guard = createProcessOperationLock(directory).tryAcquire(BROKER_LOCK_NAME);
      expect(guard).toBeDefined();
      age(directory);

      return removeStaleBrokerDirectories({ parent }).then((removed) => {
        guard?.release();
        expect(removed).toBe(0);
        expect(existsSync(directory)).toBe(true);
      });
    });

    it('keeps a directory too new to be told from one a broker is about to use', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      expect(existsSync(directory)).toBe(true);
    });

    it('keeps the directory the caller is about to use', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      leaveCrashedBroker(directory);

      expect(await removeStaleBrokerDirectories({ parent, keep: directory })).toBe(0);
      expect(existsSync(directory)).toBe(true);
    });

    it('keeps a leftover directory that a start has claimed', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      leaveCrashedBroker(directory);
      claimBrokerNamespaceDirectory(directory, owner);

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      expect(existsSync(directory)).toBe(true);
    });

    it('keeps a directory that a start claims while the sweep is checking it', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      leaveCrashedBroker(directory);
      duringNextPing(() => claimBrokerNamespaceDirectory(directory, owner));

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      expect(existsSync(directory)).toBe(true);
    });

    it('keeps a directory that was replaced while the sweep was checking it', async () => {
      const parent = fixture();
      const directory = makeDirectory(parent, namespaceName('a'));
      leaveCrashedBroker(directory);
      duringNextPing(() => {
        renameSync(directory, join(parent, 'replaced'));
        makeDirectory(parent, namespaceName('a'));
        leaveCrashedBroker(directory);
      });

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      expect(existsSync(directory)).toBe(true);
      expect(existsSync(join(parent, 'replaced', BROKER_SOCKET_NAME))).toBe(true);
    });

    it('never removes an entry that is not exactly an owner-private namespace directory of this user', async () => {
      const parent = fixture();
      const kept: string[] = [];

      // Names that are not this user's namespace names, each a stale-looking directory.
      for (const name of [
        `robota-root-${owner}-${'a'.repeat(23)}`,
        `robota-root-${owner}-${'A'.repeat(24)}`,
        `robota-root-${owner}-${'a'.repeat(24)}-extra`,
        `robota-root-${owner + 1}-${'a'.repeat(24)}`,
        `other-root-${owner}-${'a'.repeat(24)}`,
      ]) {
        const directory = makeDirectory(parent, name);
        leaveCrashedBroker(directory);
        kept.push(directory);
      }

      // A link under a valid name, to a directory that would otherwise be removed.
      const target = makeDirectory(parent, 'link-target');
      leaveCrashedBroker(target);
      const link = join(parent, namespaceName('b'));
      symlinkSync(target, link);
      kept.push(link, target);

      // A file under a valid name.
      const file = join(parent, namespaceName('c'));
      writeFileSync(file, '');
      kept.push(file);

      // A group-accessible directory.
      const open = makeDirectory(parent, namespaceName('d'));
      chmodSync(open, 0o750);
      leaveCrashedBroker(open);
      kept.push(open);

      // A directory holding something a broker never writes.
      const foreignContent = makeDirectory(parent, namespaceName('e'));
      leaveCrashedBroker(foreignContent);
      writeFileSync(join(foreignContent, 'notes.txt'), 'mine');
      age(foreignContent);
      kept.push(foreignContent);

      // A directory the current user would own, seen by a caller of another user.
      const foreignOwner = makeDirectory(parent, namespaceName('f', owner + 1));
      leaveCrashedBroker(foreignOwner);
      kept.push(foreignOwner);

      expect(await removeStaleBrokerDirectories({ parent })).toBe(0);
      for (const path of kept) expect(existsSync(path), path).toBe(true);
      expect(existsSync(join(target, BROKER_SOCKET_NAME))).toBe(true);
      expect(await removeStaleBrokerDirectories({ parent, owner: owner + 1 })).toBe(0);
      expect(existsSync(foreignOwner)).toBe(true);
    });
  },
);

describe.skipIf(process.platform === 'win32')(
  'a start claims the directory it launches a broker in',
  () => {
    it('creates a missing directory and refuses a link without touching its target', () => {
      const parent = fixture();
      const created = join(parent, namespaceName('a'));
      claimBrokerNamespaceDirectory(created, owner);
      expect(statSync(created).isDirectory()).toBe(true);
      expect(statSync(created).mode & 0o077).toBe(0);

      const target = makeDirectory(parent, 'link-target');
      age(target);
      const before = statSync(target).mtimeMs;
      const link = join(parent, namespaceName('b'));
      symlinkSync(target, link);
      expect(() => claimBrokerNamespaceDirectory(link, owner)).toThrow('not owner-private');
      expect(statSync(target).mtimeMs).toBe(before);
    });

    it('renews a leftover directory before it spawns the broker', async () => {
      const userRoot = mkdtempSync('/tmp/rbu-');
      const directory = join('/tmp', brokerNamespaceName(userRoot, owner));
      roots.push(userRoot, directory);
      mkdirSync(directory, { mode: 0o700 });
      leaveCrashedBroker(directory);
      const runtime = {
        layout: { userRoot, userPaths: { workspaceTrust: join(userRoot, 'workspace-trust.json') } },
      } as ICliRuntimeContext;

      // The broker never starts: the stand-in child ends at once, which fails the start after the spawn.
      let ageAtSpawn = Number.POSITIVE_INFINITY;
      vi.mocked(spawn).mockImplementationOnce((() => {
        ageAtSpawn = Date.now() - statSync(directory).mtimeMs;
        const child = Object.assign(new EventEmitter(), {
          connected: false,
          stderr: null,
          kill: () => true,
          disconnect: () => undefined,
          unref: () => undefined,
        });
        queueMicrotask(() => child.emit('exit', 1));
        return child;
      }) as unknown as typeof spawn);

      await expect(ensureWorkspaceRootBroker(runtime)).rejects.toThrow('could not be attached');
      expect(ageAtSpawn).toBeLessThan(60_000);
    });
  },
);
