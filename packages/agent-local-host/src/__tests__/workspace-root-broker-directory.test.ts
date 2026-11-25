import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROKER_LOCK_NAME,
  BROKER_SOCKET_NAME,
  claimBrokerNamespaceDirectory,
} from '../workspace-root-broker-directory.js';
import { requestWorkspaceRootBroker, startWorkspaceRootBroker } from '../workspace-root-broker.js';

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
  },
);
