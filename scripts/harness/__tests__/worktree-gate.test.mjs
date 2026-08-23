/**
 * The mechanical half of the worktree gates, checked against the accidents it was written for.
 *
 * Each case reproduces one incident rather than exercising a code path: an inherited `GIT_DIR`, a
 * branch a sibling worktree holds, a worktree that was never installed, a handoff from the wrong
 * branch, and build output older than the source beside it. A check that cannot be shown failing on
 * its own incident is a check nobody should trust.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  ambientGitEnvFindings,
  branchHeldElsewhereFindings,
  builtOutputDirs,
  dependenciesInstalledFindings,
  headMatchesFindings,
  listWorktrees,
  runGate,
  staleBuildFindings,
} from '../worktree-gate.mjs';

const GIT_IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function git(dir, ...args) {
  return execFileSync('git', [...GIT_IDENTITY, '-C', dir, ...args], { encoding: 'utf8' }).trim();
}

let root;
let repo;

beforeAll(() => {
  root = makeTemp('worktree-gate-');
  repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ambient git environment', () => {
  it('names every variable that would redirect a git command', () => {
    const findings = ambientGitEnvFindings({ GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/tree' });

    expect(findings.map((f) => f.check)).toEqual(['ambient-git-env', 'ambient-git-env']);
    expect(findings[0].detail).toMatch(/GIT_DIR/);
  });

  it('treats an EMPTY variable as unset', () => {
    // `GIT_DIR=` is not the same as `GIT_DIR` being absent to git, but it is to this question: an
    // empty value redirects nothing. Reading it as set was a real bug in the sibling fix that
    // deletes these variables for tests, and it broke four fixtures before it was caught.
    expect(ambientGitEnvFindings({ GIT_DIR: '' })).toEqual([]);
  });

  it('says nothing when the environment is clean', () => {
    expect(ambientGitEnvFindings({ PATH: '/usr/bin' })).toEqual([]);
  });
});

describe('a branch another worktree holds', () => {
  it('names the worktree holding it', () => {
    const held = 'held-elsewhere';
    git(repo, 'branch', held);
    const sibling = path.join(root, 'sibling');
    git(repo, 'worktree', 'add', '-q', sibling, held);

    try {
      const findings = branchHeldElsewhereFindings(held, repo);

      expect(findings).toHaveLength(1);
      expect(findings[0].check).toBe('branch-held-elsewhere');
      expect(findings[0].detail).toContain(sibling);
    } finally {
      git(repo, 'worktree', 'remove', '--force', sibling);
    }
  });

  it('does not object to the branch THIS worktree is on', () => {
    // The checked-out branch is held by a worktree — this one. Reporting it would make the gate fire
    // on every correct start, which is what gets a gate routed around.
    const current = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

    expect(branchHeldElsewhereFindings(current, repo)).toEqual([]);
  });

  it('lists every worktree and the branch each one holds', () => {
    const worktrees = listWorktrees(repo);

    expect(worktrees.length).toBeGreaterThanOrEqual(1);
    expect(worktrees[0].path).toBeTruthy();
  });

  it('reports an unreadable worktree list rather than throwing a stack trace', () => {
    // `headMatchesFindings` one function down already answers this way — an unreadable HEAD is a
    // `head-unreadable` finding, not an exception. This path did not, so the same condition
    // (a directory that is not a work tree, which is what an ambient `GIT_DIR` pointing at a
    // repository that no longer exists produces) came out of the gate as a Node stack trace
    // instead of the NON-COMPLIANCE the gate is supposed to speak in. Review found the asymmetry.
    const notARepo = path.join(root, 'not-a-repo');
    mkdirSync(notARepo, { recursive: true });

    const findings = branchHeldElsewhereFindings('any-branch', notARepo);

    expect(findings.map((f) => f.check)).toEqual(['worktrees-unreadable']);
  });
});

describe('the environment check runs before any git command', () => {
  /**
   * The ordering this file's header states, asked of the exported function rather than of `main()`.
   *
   * `runGate` evaluated every check inside one array literal, so with `GIT_DIR` set the git calls
   * below the ambient check still ran — against the repository the variable names. `main()` guarded
   * this separately, which is why the CLI was safe and the tested, exported function was not.
   *
   * The fixture makes the difference visible rather than theoretical: a SECOND repository, holding
   * the asked-about branch in a worktree of its own. The findings the unguarded version adds are
   * true of that repository and false of the one the caller is standing in.
   */
  let elsewhere;
  const HELD = 'held-over-there';

  beforeAll(() => {
    elsewhere = path.join(root, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    execFileSync('git', ['init', '-q', elsewhere]);
    writeFileSync(path.join(elsewhere, 'README.md'), '# other\n');
    git(elsewhere, 'add', '.');
    git(elsewhere, 'commit', '-q', '-m', 'init');
    git(elsewhere, 'branch', HELD);
    git(elsewhere, 'worktree', 'add', '-q', path.join(root, 'elsewhere-wt'), HELD);
  });

  function withAmbientGitDir(run) {
    const before = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, '.git');
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = before;
    }
  }

  it('answers with the ambient finding ALONE, in both phases', () => {
    withAmbientGitDir(() => {
      expect(runGate('before', HELD, repo).map((f) => f.check)).toEqual(['ambient-git-env']);
      expect(runGate('after', HELD, repo).map((f) => f.check)).toEqual(['ambient-git-env']);
    });
  });
});

describe('an unknown phase is an error, not a default', () => {
  it('THROWS instead of quietly running the after checks', () => {
    // `phase !== 'before'` meant 'after', so a typo ran the wrong check set and reported a pass it
    // never computed — an error becoming a default, which the no-fallback rule is about. `main()`
    // validates its own arguments; this pins the exported function.
    expect(() => runGate('befor', 'any-branch', repo)).toThrow(/unknown phase/);
    expect(() => runGate(undefined, 'any-branch', repo)).toThrow(/unknown phase/);
  });

  it('THROWS on a missing branch instead of skipping the checks that need it', () => {
    // The CLI validates `--branch`; this pins the exported function, where a falsy branch made both
    // branch-dependent finders return `[]` and the gate reported a pass it never computed — the
    // silent-partial-check class this PR fixed at the CLI, one level up. Review found the gap.
    expect(() => runGate('before', '', repo)).toThrow(/branch is required/);
    expect(() => runGate('after', undefined, repo)).toThrow(/branch is required/);
  });
});

describe('a worktree that was never installed', () => {
  it('reports the missing install', () => {
    const findings = dependenciesInstalledFindings(repo);

    expect(findings.map((f) => f.check)).toEqual(['dependencies-missing']);
  });

  it('says nothing once node_modules exists', () => {
    const installed = path.join(root, 'installed');
    mkdirSync(path.join(installed, 'node_modules'), { recursive: true });

    expect(dependenciesInstalledFindings(installed)).toEqual([]);
  });
});

describe('the branch being handed off', () => {
  it('reports a handoff from a different branch than the one verified', () => {
    const findings = headMatchesFindings('some-other-branch', repo);

    expect(findings.map((f) => f.check)).toEqual(['head-mismatch']);
    expect(findings[0].detail).toMatch(/verified against a different branch/);
  });

  it('says nothing when HEAD is the branch claimed', () => {
    const current = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

    expect(headMatchesFindings(current, repo)).toEqual([]);
  });
});

describe('build output left behind by another branch', () => {
  /**
   * A workspace member whose build output was written at `builtAt` and whose source changed at
   * `changedAt`.
   *
   * `output` and `source` are parameters because this repository does not have one answer for
   * either: `next build` writes `.next` (and `out`, for the exported docs site) while `tsup`,
   * `tsdown`, `vite` and `astro` write `dist`, and `apps/starter-nextjs` keeps its source in `app/`
   * rather than `src/`. A fixture that only ever spells them `dist` and `src` is a fixture that
   * agrees with the bug.
   */
  function makePackage(
    name,
    builtAt,
    changedAt,
    { output = 'dist', source = 'src', family = 'packages', ws = 'ws' } = {},
  ) {
    const pkg = path.join(root, ws, family, name);
    mkdirSync(path.join(pkg, source), { recursive: true });
    mkdirSync(path.join(pkg, output), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name }));
    const built = path.join(pkg, output, 'index.js');
    const src = path.join(pkg, source, 'index.ts');
    writeFileSync(built, '// built\n');
    writeFileSync(src, '// source\n');
    utimesSync(built, builtAt / 1000, builtAt / 1000);
    utimesSync(src, changedAt / 1000, changedAt / 1000);
  }

  const EARLIER = 1_700_000_000_000;
  const LATER = EARLIER + 60_000;

  it('reports a package whose src is newer than its dist', () => {
    makePackage('stale-one', EARLIER, LATER);

    const findings = staleBuildFindings(path.join(root, 'ws'));

    expect(findings.map((f) => f.check)).toContain('stale-build-output');
    expect(findings.some((f) => f.detail.includes('stale-one'))).toBe(true);
  });

  it('says nothing about a package built after its last source change', () => {
    rmSync(path.join(root, 'ws'), { recursive: true, force: true });
    makePackage('fresh-one', LATER, EARLIER);

    expect(staleBuildFindings(path.join(root, 'ws'))).toEqual([]);
  });

  it('says nothing about a package that was never built', () => {
    // Unbuilt is not stale. Conflating them would make this fire on every clean worktree, which is
    // the state a worktree STARTS in — the check would be noise from its first run.
    const pkg = path.join(root, 'unbuilt', 'packages', 'never-built');
    mkdirSync(path.join(pkg, 'src'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'never-built' }));
    writeFileSync(path.join(pkg, 'src', 'index.ts'), '// source\n');

    expect(staleBuildFindings(path.join(root, 'unbuilt'))).toEqual([]);
  });

  it('sees a Next.js app, whose build output is `.next` and never `dist`', () => {
    // Review measured the coverage this check actually had: it walked `apps` and then looked only
    // for `<name>/dist`, so every Next.js app in this repository — `agent-web`, `docs`,
    // `starter-nextjs`, `www` — was walked past in silence. The gate reported a pass over apps it
    // had not examined, which is the silent green it exists to remove.
    makePackage('web-thing', EARLIER, LATER, { output: '.next', family: 'apps', ws: 'next-ws' });

    const findings = staleBuildFindings(path.join(root, 'next-ws'));

    expect(findings.map((f) => f.check)).toEqual(['stale-build-output']);
    expect(findings[0].detail).toContain('.next');
  });

  it('sees an app whose source is `app/` rather than `src/`', () => {
    // `apps/starter-nextjs` has no `src/` at all, and the old `if (!existsSync(src)) continue`
    // skipped it before the output directory was ever considered.
    makePackage('router-thing', EARLIER, LATER, {
      output: '.next',
      source: 'app',
      family: 'apps',
      ws: 'app-dir-ws',
    });

    expect(staleBuildFindings(path.join(root, 'app-dir-ws')).map((f) => f.check)).toEqual([
      'stale-build-output',
    ]);
  });

  it('sees a NESTED package group', () => {
    // `packages/dag-nodes/*` is a declared workspace group, and a depth-1 `readdirSync` walks past
    // all of it — the same under-coverage `workspace-packages.mjs` was written to own.
    makePackage('dag-nodes/file-read', EARLIER, LATER, { ws: 'nested-ws' });

    expect(staleBuildFindings(path.join(root, 'nested-ws')).map((f) => f.check)).toEqual([
      'stale-build-output',
    ]);
  });

  it('names each built output it examined, so an unexamined one is visible', () => {
    // The gate prints this count. A build directory this repository does not name is read as
    // "unbuilt" — correct for a package nobody built, and silent for one built somewhere this list
    // does not know about. The count is what makes that difference showable instead of assumed.
    rmSync(path.join(root, 'counted-ws'), { recursive: true, force: true });
    makePackage('counted', LATER, EARLIER, { ws: 'counted-ws' });
    makePackage('counted-web', LATER, EARLIER, {
      output: '.next',
      family: 'apps',
      ws: 'counted-ws',
    });

    expect(
      builtOutputDirs(path.join(root, 'counted-ws'))
        .map((built) => built.label)
        .sort(),
    ).toEqual(['apps/counted-web/.next', 'packages/counted/dist']);
  });
});

describe('the gate refuses to run without the argument its checks need', () => {
  const scratch = [];
  afterAll(() => {
    while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
  });
  const GATE = path.resolve(import.meta.dirname, '../worktree-gate.mjs');

  /** Run the gate as a process, the way the skill and the agents invoke it. */
  function runGateProcess(...args) {
    const options = typeof args.at(-1) === 'object' ? args.pop() : {};
    const result = spawnSync('node', [GATE, ...args], { encoding: 'utf8', ...options });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('REFUSES a run with no --branch instead of passing over the checks it needs it for', () => {
    // Review: `--branch` was validated nowhere and the usage string spelled it `[--branch <name>]`.
    // `branchHeldElsewhereFindings` and `headMatchesFindings` both return `[]` the moment `branch`
    // is falsy, so a run without it skipped at least one core check per phase and still printed
    // `worktree-gate (...) passed.`
    //
    // That is the silent green this gate exists to remove, in the gate itself — its own stated
    // purpose is that none of these checks "should depend on someone remembering".
    for (const args of [
      ['--phase', 'before'],
      ['--phase', 'after'],
    ]) {
      const { status, output } = runGateProcess(...args);
      expect(status, args.join(' ')).toBe(2);
      expect(output).toMatch(/--branch <name> is required/);
      expect(output, 'it must not report a pass it did not compute').not.toMatch(/passed\./);
    }
  });

  it('does not die with a stack trace when the worktree list cannot be read', () => {
    // `branchHeldElsewhereFindings` was fixed to report `worktrees-unreadable` instead of throwing,
    // and review pointed out that the fix only helped the library function: `main()` prints the
    // traffic table BEFORE running any check, so the CLI — the thing the gate agents actually
    // invoke — still crashed on that line first. A stack trace does not read as the refusal the
    // rest of this script speaks in.
    const notARepo = makeTemp('worktree-gate-bare-');
    scratch.push(notARepo);

    const { status, output } = runGateProcess('--phase', 'before', '--branch', 'anything', {
      cwd: notARepo,
    });

    expect(output, 'the CLI died with a raw stack trace').not.toMatch(/at \w+ \(node:/);
    expect(output).toMatch(/worktrees-unreadable|Could not list the worktrees/);
    expect(status, 'an unreadable repository must not read as a pass').not.toBe(0);
  });

  it('REFUSES a --branch whose value is the next FLAG', () => {
    // `--branch --phase after` would otherwise take `--phase` as the branch name and check a branch
    // nothing can be holding — a pass computed over a name that does not exist.
    const { status, output } = runGateProcess('--phase', 'before', '--branch', '--phase');
    expect(status).toBe(2);
    expect(output).toMatch(/--branch <name> is required/);
  });
});
