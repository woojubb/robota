import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCENARIO_PATH = fileURLToPath(
  new URL('../verify-workspace-project-authority.ts', import.meta.url),
);

/** A git hook exports GIT_* vars into its own process tree, which `spawnSync`/ */
/** `execFileSync` inherit by default — this must not leak into the scenario's nested `git -C` calls. */
describe('GIT_DIR/GIT_WORK_TREE leak', () => {
  it('passes even when the ambient environment carries a hook-exported GIT_DIR/GIT_WORK_TREE', () => {
    // The leaked repository is the test's own, so the test needs no git checkout around it
    // (a generated product workspace has none).
    const leakedRoot = mkdtempSync(path.join(tmpdir(), 'gitdir-leak-'));
    try {
      execFileSync('git', ['init', '--quiet', leakedRoot]);
      const leakedGitDir = execFileSync(
        'git',
        ['-C', leakedRoot, 'rev-parse', '--absolute-git-dir'],
        {
          encoding: 'utf8',
        },
      ).trim();

      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--conditions=source', SCENARIO_PATH],
        {
          cwd: fileURLToPath(new URL('../..', import.meta.url)),
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            GIT_DIR: leakedGitDir,
            GIT_WORK_TREE: leakedRoot,
          },
        },
      );

      expect(JSON.parse(output)).toMatchObject({
        scenario: 'workspace-project-authority',
        cleanupRemoved: true,
      });
    } finally {
      rmSync(leakedRoot, { recursive: true, force: true });
    }
  }, 45_000);
});
