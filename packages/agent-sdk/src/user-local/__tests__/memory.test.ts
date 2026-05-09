import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteUserLocalMemoryItem,
  disableUserLocalMemoryItem,
  inspectUserLocalMemoryItem,
  listUserLocalMemoryItems,
  readEnabledUserLocalMemoryItem,
  setUserLocalMemoryItem,
} from '../memory.js';

const tempRoots: string[] = [];
const NOW = new Date('2026-05-09T00:00:00.000Z');
const LATER = new Date('2026-05-09T00:01:00.000Z');

async function createTempRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), name));
  tempRoots.push(root);
  return root;
}

async function createWorkspace(): Promise<{
  readonly repo: string;
  readonly home: string;
}> {
  const workspace = await createTempRoot('robota-user-local-memory-');
  const repo = path.join(workspace, 'repo');
  const home = path.join(workspace, 'home');
  await fs.mkdir(repo);
  await fs.mkdir(home);
  return { repo, home };
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

describe('user-local memory', () => {
  it('stores and projects display/navigation memory outside the active repository', async () => {
    const { repo, home } = await createWorkspace();

    const item = await setUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
      value: 'background',
      summary: 'Open the background panel',
      source: 'user-input',
      now: () => NOW,
    });

    expect(item).toMatchObject({
      root: path.join(home, '.robota'),
      category: 'view-preference',
      key: 'last-panel',
      summary: 'Open the background panel',
      valueSummary: 'background',
      source: 'user-input',
      scope: 'user',
      createdAt: NOW.toISOString(),
      lastUsedAt: NOW.toISOString(),
      enabled: true,
      commandExecutionEffect: 'none',
      deleteAvailable: true,
      disableAvailable: true,
    });
    expect(item.displayNavigationRule).toContain('display/navigation only');
    expect(item.storageLocation).toBe(
      path.join(home, '.robota', 'memory-projections', 'view-preference__last-panel.json'),
    );
    expect(await pathExists(path.join(repo, '.robota'))).toBe(false);
  });

  it('lists, inspects, disables, and hides disabled items from enabled reads', async () => {
    const { repo, home } = await createWorkspace();

    await setUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
      value: 'background',
      summary: 'Open the background panel',
      source: 'user-input',
      now: () => NOW,
    });

    const list = await listUserLocalMemoryItems({
      activeRepositoryRoot: repo,
      homeDir: home,
    });
    expect(list.items.map((item) => `${item.category}/${item.key}`)).toEqual([
      'view-preference/last-panel',
    ]);

    const inspected = await inspectUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
    });
    expect(inspected.enabled).toBe(true);

    const disabled = await disableUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
      now: () => LATER,
    });
    expect(disabled.enabled).toBe(false);
    expect(disabled.lastUsedAt).toBe(LATER.toISOString());

    const enabledRead = await readEnabledUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
    });
    expect(enabledRead).toBeNull();
  });

  it('deletes an item and rejects follow-up inspection', async () => {
    const { repo, home } = await createWorkspace();

    await setUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'view-preference',
      key: 'last-panel',
      value: 'background',
      summary: 'Open the background panel',
      source: 'user-input',
      now: () => NOW,
    });

    await expect(
      deleteUserLocalMemoryItem({
        activeRepositoryRoot: repo,
        homeDir: home,
        category: 'view-preference',
        key: 'last-panel',
      }),
    ).resolves.toMatchObject({
      category: 'view-preference',
      key: 'last-panel',
      deleted: true,
    });

    await expect(
      inspectUserLocalMemoryItem({
        activeRepositoryRoot: repo,
        homeDir: home,
        category: 'view-preference',
        key: 'last-panel',
      }),
    ).rejects.toThrow('ENOENT');
  });

  it('stores command-looking values as inert display values only', async () => {
    const { repo, home } = await createWorkspace();

    const item = await setUserLocalMemoryItem({
      activeRepositoryRoot: repo,
      homeDir: home,
      category: 'display-preference',
      key: 'compact-mode',
      value: 'npm test',
      summary: 'Display compact mode preference',
      source: 'user-input',
      now: () => NOW,
    });

    expect(item.commandExecutionEffect).toBe('none');
    expect(item.displayNavigationRule).toContain('only');
    expect(item).not.toHaveProperty('command');
    expect(item).not.toHaveProperty('commandString');
  });

  it('rejects a storage root inside the active repository', async () => {
    const { repo } = await createWorkspace();

    await expect(
      setUserLocalMemoryItem({
        activeRepositoryRoot: repo,
        storageRoot: path.join(repo, '.robota'),
        category: 'view-preference',
        key: 'last-panel',
        value: 'background',
        summary: 'Open the background panel',
        source: 'user-input',
      }),
    ).rejects.toThrow('outside the active repository');
  });
});
