import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * HARNESS-075 — a test must never inherit the git context of whatever launched it.
 *
 * A git HOOK exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and friends into everything it
 * launches. `.husky/pre-push` launches the verification gate, the gate launches vitest, and every
 * `git` a test spawns then inherits them — so a fixture that carefully builds its repository under
 * `mkdtemp` and passes `cwd` still writes to THE REPOSITORY BEING PUSHED FROM, because `GIT_DIR`
 * outranks `cwd`.
 *
 * That is not a hypothetical. Measured three times on 2026-08-04/05: `develop` moved onto a fixture
 * commit, `core.bare` set to true, about twenty fixture worktrees registered against the real clone
 * — and because the corrupted `develop` was then what `git push` pushed, the shared branch on the
 * REMOTE was rewritten with fixture commits. Twice.
 *
 * The fence is in `vitest.shared.ts`, which every config in the workspace inherits. This file is the
 * floor under the fence: it asserts the variables are gone at RUN TIME, which is the only place the
 * property is real.
 */
describe('the ambient git context is not inherited (HARNESS-075)', () => {
  // The set the fence removes. Read from the config rather than restated, so a variable added there
  // is covered here without anyone remembering to.
  const config = readFileSync(path.join(WORKSPACE_ROOT, 'vitest.shared.ts'), 'utf8');
  const declared = [
    ...(config.match(/const GIT_AMBIENT_ENV = \[([^\]]*)\]/s)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g),
  ].map((m) => m[1]);

  it('declares a non-empty set, so this file cannot pass over nothing', () => {
    console.log(`::examined:: ${declared.length} ambient git variables`);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain('GIT_DIR');
  });

  it('none of them reaches a running test', () => {
    // The property that matters, asserted where it matters: inside a worker, at run time. A test
    // that read the config and concluded "the deletion is written down" would pass over a fence
    // that no longer works.
    for (const name of declared) {
      expect(process.env[name], `${name} reached a test process`).toBeUndefined();
    }
  });

  it('a git command run by a test resolves to the tree it is given, not to an inherited one', () => {
    // The end-to-end form. `git rev-parse --git-dir` answers from GIT_DIR when it is set, and from
    // the cwd otherwise — so this is the same question the fixtures ask, asked directly.
    const answered = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    }).trim();

    expect(existsSync(answered), `git resolved to ${answered}, which does not exist`).toBe(true);
    expect(path.resolve(answered).startsWith(path.resolve(WORKSPACE_ROOT))).toBe(true);
  });
});
