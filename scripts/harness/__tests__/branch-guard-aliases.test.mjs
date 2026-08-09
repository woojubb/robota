/**
 * INFRA-085 (#1589) — a git alias is the verb it expands to.
 *
 * Every verb check in branch-guard keys off the literal subcommand, and the issue measured the
 * cost: with `alias.ci commit`, `git ci -n -m x` and `HUSKY=0 git ci -m x` both sailed past checks
 * that ask "is the verb commit". Configuring the alias is one visible command that nothing refuses,
 * and an agent that has learned a flag is refused has an obvious next move — the exact progression
 * #1588 documented.
 *
 * Fixtures configure REAL aliases in a scratch repository, because the hook resolves them from git
 * config through the scrub; a fake map would test the map.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/branch-guard.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function scratchRepo(branch, aliases = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'alias-guard-'));
  scratch.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, dir]);
  git('config', 'user.email', 'h@e.test');
  git('config', 'user.name', 'H');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
  for (const [name, expansion] of Object.entries(aliases)) {
    git('config', `alias.${name}`, expansion);
  }
  return dir;
}

function runHook(command, cwd) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the verb checks see through an alias', () => {
  it('reads `git ci -n` as the commit kill switch — the issue’s measured bypass', () => {
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook('git ci -n -m x', repo);

    expect(status, 'the alias hid the -n kill switch').toBe(2);
    expect(output).toMatch(/-n/);
  });

  it('reads `HUSKY=0 git ci` as a gated statement — the second measured bypass', () => {
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status } = runHook('HUSKY=0 git ci -m x', repo);

    expect(status, 'the alias hid the HUSKY=0 kill switch').toBe(2);
  });

  it('reads a flag folded INTO the alias expansion', () => {
    // `alias.ci "commit -n"` carries the kill switch inside the alias, where no statement word
    // will ever show it.
    const repo = scratchRepo('feat/x', { ci: 'commit -n' });

    const { status } = runHook('git ci -m x', repo);

    expect(status, 'the expansion-borne -n went unread').toBe(2);
  });

  it('refuses an aliased push to a protected branch', () => {
    const repo = scratchRepo('main', { p: 'push' });

    const { status } = runHook('git p origin main', repo);

    expect(status, 'the aliased push was not a push to the statement checks').toBe(2);
  });

  it('leaves an aliased commit on a feature branch alone', () => {
    // The other direction: resolution must not turn ordinary aliased work into a refusal.
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook('git ci -m "ordinary work"', repo);

    expect(status, `ordinary aliased work was refused:\n${output}`).toBe(0);
  });

  it('leaves a SHELL alias alone — the stated gap, stated here too', () => {
    // `!…` expansions are arbitrary shell, not a git verb; classifying them would mean parsing
    // shell inside git config. Invisible to the verb checks, exactly as before the fix.
    const repo = scratchRepo('feat/x', { sh: '!echo hello' });

    const { status } = runHook('git sh', repo);

    expect(status).toBe(0);
  });
});
