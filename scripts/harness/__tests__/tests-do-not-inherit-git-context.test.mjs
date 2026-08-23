import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  // The set the fence removes, read from the file that OWNS it rather than restated. It used to be
  // parsed out of `vitest.shared.ts`, which was one of three copies of this list; review found them
  // already disagreeing, so the list moved to `git-ambient-env.json` and every reader loads it.
  const declared = JSON.parse(
    readFileSync(path.join(WORKSPACE_ROOT, 'scripts/harness/git-ambient-env.json'), 'utf8'),
  ).variables;

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

  // 120s, against the root config's 10s default. This case starts a WHOLE second vitest — node
  // startup, transpiling both config files, collecting the file — and the inner `spawnSync` already
  // carries its own 120s bound. Leaving the outer default in place makes the case fail on a slow
  // runner for a reason that has nothing to do with what it asserts, which is the worst kind of red:
  // it reads as the fence being broken. It passed locally only because this machine is fast.
  it(
    'survives the variables being INJECTED, which is the only version that can fail in CI',
    { timeout: 120_000 },
    () => {
      // The case above asserts the variables are absent. Review found that vacuous where it counts:
      // continuous integration runs `pnpm harness:test` directly, never through `.husky/pre-push`, so
      // nothing sets `GIT_DIR` there in the first place. Remove the fence and that case still passes —
      // it verifies a condition that cannot fail, over the exact regression it exists to catch.
      //
      // So this one supplies the condition. It runs the suite again as a CHILD with `GIT_DIR` set, the
      // way a git hook would, and asks whether the case above still holds inside it. With the fence,
      // the child passes; without it, the child fails and so does this.
      const child = spawnSync(
        'npx',
        ['vitest', 'run', import.meta.filename, '-t', 'none of them reaches a running test'],
        {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          // A real git dir, exactly as `.husky/pre-push` would export it.
          env: { ...process.env, GIT_DIR: path.join(WORKSPACE_ROOT, '.git') },
          timeout: 120_000,
        },
      );

      const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
      expect(output, 'the child run selected no case, so it proved nothing').toMatch(/1 passed/);
      expect(child.status, output).toBe(0);
    },
  );

  it('a git command run by a test resolves from its OWN cwd, not from an inherited context', () => {
    // The end-to-end form, asked of a SCRATCH repository rather than of this checkout.
    //
    // The first version asked it of `WORKSPACE_ROOT` and required the answer to sit under it. That
    // is false in a linked worktree by construction: a worktree's `.git` is a FILE pointing at
    // `<main clone>/.git/worktrees/<id>`, so `rev-parse` correctly answers a path under the MAIN
    // clone — and the case would have failed in exactly the environment this whole fix exists to
    // make safe. Review caught it.
    //
    // A scratch repository has no such indirection, so the question is asked without a layout
    // assumption riding on it: given a cwd, does git answer from that cwd?
    const scratch = makeTemp('git-context-');
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: scratch });

      const answered = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: scratch,
        encoding: 'utf8',
      }).trim();

      expect(existsSync(answered), `git resolved to ${answered}, which does not exist`).toBe(true);
      expect(
        realpathSync(answered).startsWith(realpathSync(scratch)),
        `git answered ${answered} for a command run in ${scratch}`,
      ).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
