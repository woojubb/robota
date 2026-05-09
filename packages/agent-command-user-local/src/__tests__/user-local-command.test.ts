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
});
