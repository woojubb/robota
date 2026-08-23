import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_SRC = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * The guard's VERDICT, not the reading behind it.
 *
 * `hook-reading-matches-bash.test.mjs` proves `hook_verb_scan` agrees with bash. That is not the
 * same claim as "the guard decides correctly", and the difference was not academic: `branch-guard.sh`
 * took `COMMAND_VERBS` from `hook_verb_scan` but `COMMAND_EXEC` from a second, quote-blind reading,
 * and greps different checks against different strings. A reading can be fixed while every decision
 * that consults the OTHER string stays exactly as wrong — the "registered, never reached" shape this
 * repository keeps meeting, where a mechanism is green about something nothing calls. That second
 * reading is gone (INFRA-075, #1572); this file is the reason it was possible to notice.
 *
 * So this file asks the hook itself. Every case runs `branch-guard.sh` end to end on a scratch
 * repository, with every `BRANCH_GUARD_ALLOW_*` override scrubbed out of the environment, and
 * asserts the exit code and the branch the guard names.
 *
 * Hermetic in the sense #1567 established: the hooks tree is copied to a temp directory OUTSIDE
 * `.claude/worktrees/`, so the guard's reading of its own path does not depend on where the suite
 * happens to be checked out. `gh` is stubbed to fail loudly, so a case that is supposed to be
 * decided locally can never quietly reach the network and pass for the wrong reason.
 */
function scratchRepo() {
  const dir = makeTemp('bg-repo-');
  const run = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  run('init', '--quiet', '--initial-branch=main');
  writeFileSync(path.join(dir, 'f.txt'), 'x\n');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'chore: root');
  run('remote', 'add', 'origin', 'https://example.invalid/scratch.git');
  return dir;
}

/** The hooks tree, copied out of any worktree path, plus a `gh` that records and fails. */
function hooksSandbox() {
  const dir = makeTemp('bg-hooks-');
  const hooks = path.join(dir, '.claude', 'hooks');
  mkdirSync(path.dirname(hooks), { recursive: true });
  cpSync(HOOKS_SRC, hooks, { recursive: true });

  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const ghCalls = path.join(dir, 'gh-calls.log');
  writeFileSync(
    path.join(bin, 'gh'),
    ['#!/bin/sh', `printf '%s\\n' "$*" >> ${JSON.stringify(ghCalls)}`, 'exit 1', ''].join('\n'),
  );
  chmodSync(path.join(bin, 'gh'), 0o755);

  return { hook: path.join(hooks, 'branch-guard.sh'), bin, ghCalls };
}

function runGuard(command) {
  const repo = scratchRepo();
  const { hook, bin, ghCalls } = hooksSandbox();
  const result = spawnSync('bash', [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }),
    encoding: 'utf8',
    cwd: repo,
    // Only PATH, HOME and the project dir. Every BRANCH_GUARD_ALLOW_* override is absent by
    // construction, so nothing below can pass because it was permitted to.
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: repo },
    timeout: 60_000,
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    reachedGh: existsSync(ghCalls),
  };
}

const NL = '\n';

describe('branch-guard decides correctly on commands the old reading could not parse', () => {
  it('blocks a plain push on a protected branch', () => {
    // The control. Without it, a file where everything blocks would look like a working guard.
    const verdict = runGuard('git push origin main');
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/protected branch 'main'/);
  });

  // Each of these ran a real push on `develop` while exiting 0 — reproduced against the guard on
  // develop before this landed. A guard that exits 0 on a real push is not a weaker guard, it is an
  // absent one.
  const BYPASSES = [
    ['a line continuation splits the invocation across lines', `git \\${NL}  push origin main`],
    ['a substitution nested inside a substitution', 'a=$(echo "$(git push origin main)")'],
    [
      'a substitution inside an unquoted heredoc body',
      `cat <<EOF${NL}$(echo "$(git push origin main)")${NL}EOF`,
    ],
  ];

  for (const [label, command] of BYPASSES) {
    it(`blocks a push hidden by ${label}`, () => {
      const verdict = runGuard(command);
      expect(verdict.status, `the guard allowed a real push:\n${verdict.output}`).toBe(2);
      expect(verdict.output).toMatch(/protected branch 'main'/);
    });
  }

  it('names the branch a nested delete actually targets, and refuses it as protected', () => {
    // The reading and the VERDICT are different claims. Once the substitution became visible, the
    // delete was seen — but the branch name came back as `develop)`, because the value terminator
    // stopped at whitespace and quotes and did not know that `)` ends a substitution. The guard
    // still refused, so nothing was permitted that should not have been; it refused on the
    // merged-PR check instead of the protected-branch check, naming a branch that does not exist.
    // A guard that blocks for the wrong reason is one branch-name away from blocking nothing.
    const verdict = runGuard('a=$(echo "$(git push origin --delete develop)")');
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/protected branch 'develop'/);
    expect(verdict.output).not.toMatch(/develop\)/);
    expect(
      verdict.reachedGh,
      'the protected-branch check should have decided this locally, before any PR lookup',
    ).toBe(false);
  });

  // The other half of the trade. A guard that refuses correct work gets switched off, so the
  // mentions matter as much as the invocations.
  it('says nothing about a push named inside a quoted argument', () => {
    const verdict = runGuard("echo 'git push origin main'");
    expect(verdict.status, `the guard refused an echo:\n${verdict.output}`).toBe(0);
  });

  it('says nothing about a push named inside a heredoc body with a quoted delimiter', () => {
    const verdict = runGuard(`cat <<'EOF'${NL}git push origin main${NL}EOF`);
    expect(verdict.status, `the guard refused a heredoc body:\n${verdict.output}`).toBe(0);
  });
});
