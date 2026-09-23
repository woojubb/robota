import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCENARIO_PATH = fileURLToPath(
  new URL('../verify-workspace-project-authority.ts', import.meta.url),
);

/** BEHAVIOR-2650: a git hook exports GIT_* vars into its own process tree, which `spawnSync`/ */
/** `execFileSync` inherit by default — this must not leak into the scenario's nested `git -C` calls. */
describe('ARCH-042 scenario — GIT_DIR/GIT_WORK_TREE leak (BEHAVIOR-2650)', () => {
  it('passes even when the ambient environment carries a hook-exported GIT_DIR/GIT_WORK_TREE', () => {
    const leakedGitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8',
    }).trim();

    const output = execFileSync('pnpm', ['exec', 'tsx', '--conditions=source', SCENARIO_PATH], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_DIR: leakedGitDir,
        GIT_WORK_TREE: process.cwd(),
      },
    });

    expect(JSON.parse(output)).toMatchObject({ scenario: 'ARCH-042', cleanupRemoved: true });
  });
});
