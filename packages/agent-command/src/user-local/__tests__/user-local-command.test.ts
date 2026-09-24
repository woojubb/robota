import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeUserLocalCommand, executeUserLocalDirectCommand } from '../user-local-command.js';
import { createUserLocalCommandModule } from '../user-local-command-module.js';

const tempRoots: string[] = [];

async function createTempRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), name));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('user-local command', () => {
  it('does not advertise a specific product from the neutral command entry', () => {
    const module = createUserLocalCommandModule('/tmp/selected-storage');
    expect(module.commandSources?.[0]?.getCommands()[0]?.description).not.toMatch(/Robota/i);
  });

  it('fails closed when a direct caller omits the storage root', async () => {
    const workspace = await createTempRoot('robota-user-local-missing-root-');
    const repo = path.join(workspace, 'repo');
    await fs.mkdir(repo);

    const result = await executeUserLocalDirectCommand({
      cwd: repo,
      argv: ['storage', 'list'],
    } as never);
    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain('userLocalStorageRoot is required');
  });

  it('uses the explicit root for slash commands', async () => {
    const workspace = await createTempRoot('robota-user-local-slash-root-');
    const repo = path.join(workspace, 'repo');
    const selectedRoot = path.join(workspace, 'selected', '.robota');
    await fs.mkdir(repo);
    vi.stubEnv('HOME', path.join(workspace, 'ambient-home'));

    const directResult = await executeUserLocalCommand(
      { getCwd: () => repo } as never,
      'storage list --format=json',
      selectedRoot,
    );
    expect(directResult.success).toBe(true);
    expect(JSON.parse(directResult.message)).toMatchObject({ root: selectedRoot });

    const slashCommand = createUserLocalCommandModule(selectedRoot).systemCommands?.[0];
    expect(slashCommand).toBeDefined();
    const result = await slashCommand!.execute(
      { getCwd: () => repo } as never,
      'storage list --format=json',
    );
    expect(result.success).toBe(true);
    expect(JSON.parse(result.message)).toMatchObject({ root: selectedRoot });
  });

  it('prints storage inspection JSON without provider configuration', async () => {
    const workspace = await createTempRoot('robota-user-local-command-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);
    vi.stubEnv('HOME', path.join(workspace, 'ambient-home'));

    const result = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['storage', 'list'],
      format: 'json',
    });
    const parsed = JSON.parse(result.message) as {
      root: string;
      categories: readonly { category: string; mayExecuteCommands: boolean }[];
    };

    expect(result.success).toBe(true);
    expect(parsed.root).toBe(path.join(home, '.robota'));
    expect(parsed.categories.map((item) => item.category)).toEqual([
      'preferences',
      'view-state',
      'memory-projections',
      'task-associations',
      'workflow-metadata',
      'inspection-index',
    ]);
    expect(parsed.categories.every((item) => item.mayExecuteCommands === false)).toBe(true);
  });

  it('stores, lists, inspects, disables, and deletes user-local memory items', async () => {
    const workspace = await createTempRoot('robota-user-local-memory-command-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);
    vi.stubEnv('HOME', path.join(workspace, 'ambient-home'));

    const setResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'set', 'view-preference', 'last-panel', 'background'],
      summary: 'Open the background panel',
      source: 'user-input',
    });
    expect(setResult.success).toBe(true);
    expect(setResult.message).toContain('view-preference/last-panel');

    const listResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'list'],
      format: 'json',
    });
    const list = JSON.parse(listResult.message) as {
      items: readonly { category: string; key: string; enabled: boolean }[];
    };
    expect(listResult.success).toBe(true);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      category: 'view-preference',
      key: 'last-panel',
      enabled: true,
    });

    const inspectResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'inspect', 'view-preference', 'last-panel'],
      format: 'json',
    });
    const inspected = JSON.parse(inspectResult.message) as {
      commandExecutionEffect: string;
      displayNavigationRule: string;
    };
    expect(inspectResult.success).toBe(true);
    expect(inspected.commandExecutionEffect).toBe('none');
    expect(inspected.displayNavigationRule).toContain('display/navigation only');

    const disableResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'disable', 'view-preference', 'last-panel'],
    });
    expect(disableResult.success).toBe(true);

    const disabledInspectResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'inspect', 'view-preference', 'last-panel'],
      format: 'json',
    });
    const disabled = JSON.parse(disabledInspectResult.message) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    const deleteResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'delete', 'view-preference', 'last-panel'],
    });
    expect(deleteResult.success).toBe(true);

    const missingResult = await executeUserLocalDirectCommand({
      cwd: repo,
      storageRoot: path.join(home, '.robota'),
      argv: ['memory', 'inspect', 'view-preference', 'last-panel'],
      format: 'json',
    });
    expect(missingResult.success).toBe(false);
    expect(missingResult.message).toBe('User-local memory item not found.');
  });
});
