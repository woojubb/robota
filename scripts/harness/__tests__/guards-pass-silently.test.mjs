import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Hooks whose OWN LOCATION is an input to their decision, and which must therefore be spawned
 * from a copy outside `.claude/worktrees/` for a main-clone fixture to mean anything.
 *
 * Only these. Redirecting every hook was tried first and measured: `pre-push-check.sh` resolves
 * the review recorder relative to itself, so from a copy it refused ordinary work with `cannot
 * check the review record (node or the recorder is missing)` — a guard turned noisy by the very
 * change meant to stop guards being noisy. The copy is hermetic for the session-identity input
 * and NOT for sibling-tool resolution, so it is applied exactly where the first matters.
 */
const LOCATION_SENSITIVE = new Set(['worktree-cwd-guard.sh']);
const MAIN_CLONE_HOOKS = hooksOutsideAWorktree();
const hookPath = (hook) =>
  path.join(LOCATION_SENSITIVE.has(hook) ? MAIN_CLONE_HOOKS : HOOKS_DIR, hook);

/**
 * A guard that fires on a correct, desirable state is a defect of the same severity as one that
 * misses a violation.
 *
 * Measured over four days: the one-branch-at-a-time check reported 83 branches, 73 of which had a
 * merged PR — an 88% false-positive rate, reflex-overridden twice in one session by its own author.
 * The promotion-amnesty gate reported the debt being PAID as a violation and blocked every
 * promotion. The progress-quantification scan blocked the release gate twice, once on a message
 * discussing its own false positive. Two parser defects refused the creation of the branch their own
 * fix lived on.
 *
 * Every one of those shipped with negative cases and passed them. What none of them had was the
 * legitimate counterpart asserted to pass SILENTLY — and silence is the property that matters,
 * because a guard that narrates on the happy path teaches everyone to stop reading it, after which
 * it might as well not fire at all.
 *
 * So: for every hook that refuses anything, at least one ordinary, correct invocation of what it
 * guards must run through it with exit 0 and nothing on either stream. A hook that speaks by design
 * declares it, with a reason.
 *
 * What this cannot claim: that the registry covers every guarded verb. Deriving the LEGITIMATE
 * counterpart from source is not possible — nothing in `Blocked: cannot git merge into 'main'` says
 * that `git merge develop` on a feature branch is the invocation that must pass. That half is
 * authored. What is mechanical is the fail-closed half: a hook that refuses and has NO row fails.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

/** A repository on `branch`, with an origin whose `develop` is this commit. */
function repoWithOrigin(branch) {
  const origin = scratchDir('guard-origin-');
  spawnSync('git', ['init', '--quiet', '--bare', '--initial-branch=develop', origin]);
  const dir = scratchDir('guard-repo-');
  spawnSync('git', ['init', '--quiet', '--initial-branch=develop', dir]);
  git(dir, 'config', 'user.email', 'harness@example.test');
  git(dir, 'config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'chore: root');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '--quiet', 'origin', 'develop');
  if (branch !== 'develop') git(dir, 'checkout', '--quiet', '-b', branch);
  return dir;
}

/**
 * Ambient variables a hook READS AS A DECISION INPUT, removed before spawning one.
 *
 * Review of #1567. This file's whole claim is that a guard stayed silent because the work was
 * correct. Every one of these can make it silent for a different reason, and each is inherited from
 * whatever session happens to run the suite:
 *
 * - `ROBOTA_AGENT_WORKTREE` — the worktree-session marker. The `worktree-cwd-guard` row asserts an
 *   ordinary main-clone `git reset --hard` passes silently, which requires `IN_WORKTREE_SESSION` to
 *   be false. This PR controlled the `SELF_DIR` input to that decision and left this one inherited,
 *   which is the same defect one variable to the left.
 * - `*_ALLOW_*` overrides — an exported one DISARMS the guard, so the row would pass because nothing
 *   was checked. That is an accidental green in the exact shape this directory exists to prevent.
 * - `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` / `GIT_PREFIX` — INFRA-077 measured that with
 *   `GIT_DIR` exported, `git -C <scratch>` reports the OUTER repository, so a guard judges a
 *   different checkout than the fixture built.
 *
 * A blanket scrub to `{ PATH, HOME }` (what the two sibling files do) is not usable here: the rows
 * in this file run git, node and pnpm across every hook, and several need the ambient environment to
 * work at all. Naming the decision inputs is the part that matters.
 */
const DECISION_INPUTS = [
  'ROBOTA_AGENT_WORKTREE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
];

function ambientWithoutDecisionInputs() {
  const clean = { ...process.env };
  for (const name of DECISION_INPUTS) delete clean[name];
  for (const name of Object.keys(clean)) {
    // `*_ALLOW_*` AND `*_ACK` — the two spellings this directory's overrides use. Only the first was
    // scrubbed, which left `MERGE_GATE_ACK`, `FOREGROUND_WAIT_ACK` and `BULK_EDIT_ACK` inherited
    // from whatever session runs the suite. An exported one disarms its guard, so the row would pass
    // because nothing was checked — the accidental green named two paragraphs up, in the other
    // spelling.
    if (/_ALLOW_|_ACK$/.test(name)) delete clean[name];
  }
  return clean;
}

function runHook(hook, { command, cwd, env = {}, payload }) {
  const input = payload ?? JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const result = spawnSync('bash', [hookPath(hook)], {
    input,
    cwd,
    encoding: 'utf8',
    // stdout AND stderr: a hook that spoke on stdout only would read as silence otherwise, and
    // every refusal in this directory writes to stderr.
    env: { ...ambientWithoutDecisionInputs(), CLAUDE_PROJECT_DIR: cwd, ...env },
    timeout: 120_000,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * The authored half. Each row is one ordinary, correct invocation of something the hook guards.
 *
 * `speaks` is the declared exception, and it carries a reason: a gate whose contract is to report
 * what it established cannot also be silent. Anti-rot below rejects a `speaks` with no reason.
 */
const REGISTRY = [
  {
    hook: 'branch-guard.sh',
    verb: 'git commit',
    setup: () => repoWithOrigin('feat/probe'),
    command: 'git commit -m "feat: ordinary work"',
  },
  {
    hook: 'branch-guard.sh',
    verb: 'git push',
    setup: () => repoWithOrigin('feat/probe'),
    command: 'git push -u origin feat/probe',
  },
  {
    hook: 'branch-guard.sh',
    verb: 'git merge',
    setup: () => repoWithOrigin('feat/probe'),
    command: 'git merge develop',
  },
  {
    hook: 'branch-guard.sh',
    verb: 'git checkout -b',
    setup: () => repoWithOrigin('develop'),
    command: 'git checkout -b feat/next origin/develop',
  },
  {
    hook: 'worktree-cwd-guard.sh',
    verb: 'git reset --hard',
    // No worktree marker and no worktree path: an ordinary main-clone session, which this guard
    // must leave entirely alone. It exited on its first line in every real session for a week
    // (INFRA-068), so the silent path is the one that has to keep working.
    setup: () => repoWithOrigin('feat/probe'),
    command: 'git reset --hard HEAD',
  },
  {
    hook: 'check-forbidden-patterns.sh',
    verb: 'Edit of package source',
    setup: () => {
      const dir = scratchDir('guard-src-');
      mkdirSync(path.join(dir, 'packages/p/src'), { recursive: true });
      return dir;
    },
    payload: (dir) =>
      JSON.stringify({
        tool_name: 'Edit',
        tool_input: {
          file_path: path.join(dir, 'packages/p/src/a.ts'),
          new_string: 'try {\n  go();\n} catch (e) {\n  throw e;\n}\n',
        },
      }),
  },
  {
    hook: 'merge-gate.sh',
    verb: 'gh pr merge',
    speaks:
      'the gate cannot judge whether a prose finding was ADDRESSED, so it reports what it did ' +
      'establish and tells the human to read the review — pinned by merge-gate-decision.test.mjs',
  },
  {
    hook: 'no-foreground-wait.sh',
    verb: 'pnpm build',
    // The statement this guard must be held to: a long-running command is NOT a wait. A build or a
    // test suite may occupy the foreground for minutes and that is correct work — what it refuses
    // is spending the turn waiting for something ELSE to change.
    setup: () => scratchDir('guard-no-wait-'),
    command: 'pnpm build',
  },
  {
    hook: 'bulk-edit-guard.sh',
    verb: 'a bulk edit sourced from git ls-files',
    // The invocation the rule ASKS FOR. A guard against reaching node_modules that also complains
    // about the sanctioned way to enumerate would make the sanctioned way feel no safer than the
    // hazardous one, and the rule would be read as noise.
    setup: () => scratchDir('guard-bulk-edit-'),
    command: "git ls-files -z '*.ts' | xargs -0 sed -i 's/a/b/'",
  },
  {
    hook: 'bulk-edit-guard.sh',
    verb: 'Write of package source',
    setup: () => {
      const dir = scratchDir('guard-bulk-write-');
      mkdirSync(path.join(dir, 'packages/p/src'), { recursive: true });
      return dir;
    },
    payload: (dir) =>
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: path.join(dir, 'packages/p/src/a.ts'), content: 'export {};\n' },
      }),
  },
  {
    hook: 'pre-push-check.sh',
    verb: 'git push',
    setup: () => {
      const dir = repoWithOrigin('feat/probe');
      const rec = path.join(dir, '.agents/local-reviews');
      mkdirSync(rec, { recursive: true });
      const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      writeFileSync(
        path.join(rec, 'feat%2Fprobe.json'),
        JSON.stringify({ branch: 'feat/probe', headSha: sha, findings: 0 }),
      );
      return dir;
    },
    command: 'git push -u origin feat/probe',
  },
];

/** Hooks that refuse something. Mechanical: a refusal is an operator-facing `Blocked:` line. */
const REFUSING_HOOKS = readdirSync(HOOKS_DIR)
  .filter((n) => n.endsWith('.sh'))
  .filter((n) => readFileSync(path.join(HOOKS_DIR, n), 'utf8').includes('Blocked:'))
  .sort();

describe('a guard leaves correct work alone, and says nothing about it', () => {
  it('finds hooks and rows to check', () => {
    // Fail closed: a moved directory or an emptied registry would make every assertion below pass
    // over nothing, which is the shape this repository has been burned by more than any other.
    expect(REFUSING_HOOKS.length).toBeGreaterThan(0);
    expect(REGISTRY.length).toBeGreaterThan(0);
  });

  it('has a row for every hook that refuses anything', () => {
    // The mechanical half. A new guarded hook cannot land with only negative cases: it lands with
    // at least one statement about what it must NOT do.
    const covered = new Set(REGISTRY.map((r) => r.hook));
    const uncovered = REFUSING_HOOKS.filter((h) => !covered.has(h));

    expect(
      uncovered,
      'these hooks refuse something and no row says what they must leave alone. A guard measured ' +
        'only by what it blocks is measured on half its behaviour, and the other half is what gets ' +
        'it disabled.',
    ).toEqual([]);
  });

  it('rejects a speaks-by-design row that gives no reason', () => {
    // Anti-rot, the convention `allow-fake` and `allow-fallback` already use. `speaks` is the way
    // out of this floor, so an unreasoned one is the way to make the floor decorative.
    const unreasoned = REGISTRY.filter((r) => 'speaks' in r && !String(r.speaks ?? '').trim());

    expect(unreasoned.map((r) => `${r.hook}:${r.verb}`)).toEqual([]);
  });

  for (const row of REGISTRY.filter((r) => !r.speaks)) {
    it(`${row.hook} says nothing about an ordinary ${row.verb}`, () => {
      const dir = row.setup();
      const verdict = runHook(row.hook, {
        command: row.command,
        cwd: dir,
        payload: row.payload?.(dir),
      });

      expect(verdict.status, `it refused ordinary work: ${verdict.output}`).toBe(0);
      expect(
        verdict.output.trim(),
        'it let the work through and narrated. A guard that speaks on the happy path is one ' +
          'everybody learns to scroll past, and then it might as well not fire at all.',
      ).toBe('');
    });
  }
});
