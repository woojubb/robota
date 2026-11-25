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
  workspaceRootBrokerEndpoint,
} from '../workspace-root-broker-process.js';
import { requestWorkspaceRootBroker, startWorkspaceRootBroker } from '../workspace-root-broker.js';
import { fixtureBrokerLauncher, neverLaunch } from './helpers/fixture-broker.js';

import type { IWorkspaceRootBrokerServe } from '../workspace-root-broker-process.js';

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

async function exited(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The broker ${pid} did not exit.`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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
    it('renews a leftover directory before it spawns the broker', async () => {
      const userRoot = mkdtempSync('/tmp/rbu-');
      const directory = join('/tmp', brokerNamespaceName(userRoot, owner));
      roots.push(userRoot, directory);
      mkdirSync(directory, { mode: 0o700 });
      leaveCrashedBroker(directory);
      const start = { userRoot, historyFile: join(userRoot, 'workspace-trust.json') };

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

      await expect(ensureWorkspaceRootBroker(start, fixtureBrokerLauncher)).rejects.toThrow(
        'could not be attached',
      );
      expect(ageAtSpawn).toBeLessThan(60_000);
    });
  },
);

describe.skipIf(process.platform === 'win32')(
  'a start runs the launcher the composition root supplies',
  () => {
    it('launches one broker with the values it names and attaches to it afterwards', async () => {
      const userRoot = mkdtempSync('/tmp/rbl-');
      const endpoint = workspaceRootBrokerEndpoint(userRoot);
      const directory = join('/tmp', brokerNamespaceName(userRoot, owner));
      roots.push(userRoot, directory);
      const start = { userRoot, historyFile: join(userRoot, 'workspace-trust.json') };
      const asked: IWorkspaceRootBrokerServe[] = [];

      expect(
        await ensureWorkspaceRootBroker(start, (broker) => {
          asked.push(broker);
          return fixtureBrokerLauncher(broker);
        }),
      ).toBe(endpoint);
      expect(asked).toEqual([
        { endpoint, lockDirectory: directory, historyFile: start.historyFile },
      ]);
      const live = await requestWorkspaceRootBroker(endpoint, { op: 'ping' });
      if (live.status !== 'ready') throw new Error('The launched broker does not answer.');
      try {
        // A live broker needs no launch: the launcher is not asked again.
        expect(await ensureWorkspaceRootBroker(start, neverLaunch)).toBe(endpoint);
      } finally {
        process.kill(live.pid);
        await exited(live.pid);
      }
    }, 30_000);
  },
);
