import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  USER_LOCAL_STORAGE_CATEGORIES,
  inspectUserLocalStorage,
  resolveUserLocalStorageRoot,
} from '../storage.js';

const tempRoots: string[] = [];

async function createTempRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), name));
  tempRoots.push(root);
  return root;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('user-local storage', () => {
  it('resolves the default root under injected user home outside the active repository', async () => {
    const workspace = await createTempRoot('robota-user-local-default-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);

    const root = await resolveUserLocalStorageRoot({
      activeRepositoryRoot: repo,
      homeDir: home,
    });

    expect(root).toBe(path.join(home, '.robota'));
  });

  it('rejects storage roots inside the active repository', async () => {
    const workspace = await createTempRoot('robota-user-local-reject-');
    const repo = path.join(workspace, 'repo');
    await fs.mkdir(repo);

    await expect(
      resolveUserLocalStorageRoot({
        activeRepositoryRoot: repo,
        storageRoot: path.join(repo, '.robota'),
      }),
    ).rejects.toThrow('outside the active repository');
  });

  it('rejects symlinked roots that resolve inside the active repository', async () => {
    const workspace = await createTempRoot('robota-user-local-symlink-');
    const repo = path.join(workspace, 'repo');
    const target = path.join(repo, '.robota');
    const link = path.join(workspace, 'linked-root');
    await fs.mkdir(target, { recursive: true });
    await fs.symlink(target, link);

    await expect(
      resolveUserLocalStorageRoot({
        activeRepositoryRoot: repo,
        storageRoot: link,
      }),
    ).rejects.toThrow('outside the active repository');
  });

  it('projects stable categories without writing repository-local state', async () => {
    const workspace = await createTempRoot('robota-user-local-inspect-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);

    const inspection = await inspectUserLocalStorage({
      activeRepositoryRoot: repo,
      homeDir: home,
      now: () => new Date('2026-05-09T00:00:00.000Z'),
    });

    expect(inspection).toMatchObject({
      root: path.join(home, '.robota'),
      activeRepositoryRoot: repo,
      generatedAt: '2026-05-09T00:00:00.000Z',
    });
    expect(inspection.categories.map((item) => item.category)).toEqual([
      ...USER_LOCAL_STORAGE_CATEGORIES,
    ]);
    expect(inspection.categories.every((item) => item.mayExecuteCommands === false)).toBe(true);
    expect(inspection.categories.every((item) => item.itemCount === 0)).toBe(true);
    expect(await pathExists(path.join(repo, '.robota'))).toBe(false);
  });
});
