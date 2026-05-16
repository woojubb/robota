import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeUserLocalDirectCommand } from '../user-local-command.js';

const tempRoots: string[] = [];

async function createTempRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), name));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('user-local command', () => {
  it('prints storage inspection JSON without provider configuration', async () => {
    const workspace = await createTempRoot('robota-user-local-command-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);
    const originalHome = process.env.HOME;
    process.env.HOME = home;

    try {
      const result = await executeUserLocalDirectCommand({
        cwd: repo,
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
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it('stores, lists, inspects, disables, and deletes user-local memory items', async () => {
    const workspace = await createTempRoot('robota-user-local-memory-command-');
    const repo = path.join(workspace, 'repo');
    const home = path.join(workspace, 'home');
    await fs.mkdir(repo);
    await fs.mkdir(home);
    const originalHome = process.env.HOME;
    process.env.HOME = home;

    try {
      const setResult = await executeUserLocalDirectCommand({
        cwd: repo,
        argv: ['memory', 'set', 'view-preference', 'last-panel', 'background'],
        summary: 'Open the background panel',
        source: 'user-input',
      });
      expect(setResult.success).toBe(true);
      expect(setResult.message).toContain('view-preference/last-panel');

      const listResult = await executeUserLocalDirectCommand({
        cwd: repo,
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
        argv: ['memory', 'disable', 'view-preference', 'last-panel'],
      });
      expect(disableResult.success).toBe(true);

      const disabledInspectResult = await executeUserLocalDirectCommand({
        cwd: repo,
        argv: ['memory', 'inspect', 'view-preference', 'last-panel'],
        format: 'json',
      });
      const disabled = JSON.parse(disabledInspectResult.message) as { enabled: boolean };
      expect(disabled.enabled).toBe(false);

      const deleteResult = await executeUserLocalDirectCommand({
        cwd: repo,
        argv: ['memory', 'delete', 'view-preference', 'last-panel'],
      });
      expect(deleteResult.success).toBe(true);

      const missingResult = await executeUserLocalDirectCommand({
        cwd: repo,
        argv: ['memory', 'inspect', 'view-preference', 'last-panel'],
        format: 'json',
      });
      expect(missingResult.success).toBe(false);
      expect(missingResult.message).toBe('User-local memory item not found.');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});
