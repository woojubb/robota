/**
 * User-local storage is platform-neutral: it reads and writes only through the `fsAsync` it is
 * handed, takes only absolute paths (a relative one would be anchored to the process directory,
 * which is not read), and decides "inside the repository" on path segments of the platform the path
 * is spelled for, so a Windows-spelled root is judged the same on every host.
 */

import { describe, expect, it } from 'vitest';

import { listUserLocalMemoryItems, setUserLocalMemoryItem } from '../memory.js';
import { inspectUserLocalStorage, resolveUserLocalStorageRoot } from '../storage.js';

import type { IFileSystemAsync } from '@robota-sdk/agent-core';

/** A file system where every path is its own canonical form and every directory is empty. */
function identityFileSystem(): IFileSystemAsync {
  const unused = (): never => {
    throw new Error('not used');
  };
  return {
    access: unused,
    copyFile: unused,
    mkdir: async () => undefined,
    readFile: async (path: string) => {
      throw new Error(`ENOENT: no such file, open '${path}'`);
    },
    readdir: (async () => []) as IFileSystemAsync['readdir'],
    realpath: async (path: string) => path,
    rename: unused,
    rm: unused,
    stat: unused,
    writeFile: async () => undefined,
  };
}

const fsAsync = identityFileSystem();

describe('the user-local storage root', () => {
  it.each([
    ['on a Windows drive', 'C:\\Users\\me\\repo', 'D:\\state\\agent', 'D:\\state\\agent'],
    [
      'beside a Windows repository',
      'C:\\Users\\me\\repo',
      'C:\\Users\\me\\state',
      'C:\\Users\\me\\state',
    ],
    ['beside a POSIX repository', '/home/me/repo', '/home/me/state/', '/home/me/state'],
  ])('is accepted %s, and returned normalised', async (_label, repo, storageRoot, expected) => {
    await expect(
      resolveUserLocalStorageRoot({ activeRepositoryRoot: repo, storageRoot, fsAsync }),
    ).resolves.toBe(expected);
  });

  it.each([
    ['inside a Windows repository', 'C:\\Users\\me\\repo', 'C:\\Users\\me\\repo\\.agent'],
    ['inside it under another letter case', 'C:\\Users\\me\\Repo', 'c:\\users\\me\\repo\\.agent'],
    ['the repository itself', 'C:\\Users\\me\\repo', 'C:\\Users\\me\\repo\\'],
    ['inside a POSIX repository', '/home/me/repo', '/home/me/repo/.agent'],
    ['in a directory whose name starts with two dots', '/home/me/repo', '/home/me/repo/..state'],
  ])('is refused %s', async (_label, repo, storageRoot) => {
    await expect(
      resolveUserLocalStorageRoot({ activeRepositoryRoot: repo, storageRoot, fsAsync }),
    ).rejects.toThrow('outside the active repository');
  });

  it.each([
    ['activeRepositoryRoot', { activeRepositoryRoot: 'repo', storageRoot: '/home/me/state' }],
    ['userLocalStorageRoot', { activeRepositoryRoot: '/home/me/repo', storageRoot: 'state' }],
    ['userLocalStorageRoot', { activeRepositoryRoot: '/home/me/repo', storageRoot: '.\\state' }],
  ])(
    'refuses a relative %s rather than anchoring it to the process directory',
    async (name, paths) => {
      await expect(resolveUserLocalStorageRoot({ ...paths, fsAsync })).rejects.toThrow(
        `${name} must be an absolute path`,
      );
    },
  );

  it('refuses to run without a file system and says what to pass', async () => {
    const options = { activeRepositoryRoot: '/home/me/repo', storageRoot: '/home/me/state' };
    await expect(resolveUserLocalStorageRoot(options as never)).rejects.toThrow(
      /requires `fsAsync`/,
    );
    await expect(inspectUserLocalStorage(options as never)).rejects.toThrow(/NodeFileSystemAsync/);
    await expect(listUserLocalMemoryItems(options as never)).rejects.toThrow(/requires `fsAsync`/);
    await expect(
      setUserLocalMemoryItem({
        ...options,
        category: 'view-preference',
        key: 'k',
        value: 'v',
        summary: 's',
        source: 'test',
      } as never),
    ).rejects.toThrow(/requires `fsAsync`/);
  });

  it('is projected from the root it was given, spelled for the platform of that root', async () => {
    const inspection = await inspectUserLocalStorage({
      activeRepositoryRoot: 'C:\\Users\\me\\repo',
      storageRoot: 'C:\\Users\\me\\state',
      fsAsync,
      createDirectories: false,
    });
    expect(inspection.root).toBe('C:\\Users\\me\\state');
    expect(inspection.categories[0]?.storageLocation).toBe('C:\\Users\\me\\state\\preferences');
  });
});
