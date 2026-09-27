/**
 * #3282 §4c — `InteractiveSession.readProjectStatus`/`readProjectDiff`/`readProjectMemory` wired end
 * to end through a REAL session over a REAL temporary git repository (not a mock of the git reader —
 * `agent-framework/src/git/__tests__` already covers that; this proves the session forwards its own
 * `cwd` and maps the reader's result into the `kind`-tagged wire shape). `HOME` is pointed at a temp
 * dir for the repo's own git identity (AGENTS.md).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession } from '../../testing/index.js';

import type { ScriptedSessionHarness } from '../../testing/index.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function hermeticGitEnv(): NodeJS.ProcessEnv {
  const home = tempDir('project-session-home-');
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home };
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = join(home, 'gitconfig');
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[commit]\n\tgpgsign = false\n');
  return env;
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function withSession(
  repo: string,
  run: (harness: ScriptedSessionHarness) => Promise<void>,
): Promise<void> {
  const harness = await scriptedSession({ cwd: repo, turns: [], bare: true });
  try {
    await run(harness);
  } finally {
    await harness.dispose();
  }
}

describe('InteractiveSession project reads', () => {
  it('readProjectStatus reports a plain not-a-repository kind outside any repo', async () => {
    const folder = tempDir('project-session-plain-');
    await withSession(folder, async (harness) => {
      await expect(harness.session.readProjectStatus()).resolves.toEqual({ kind: 'not-a-repository' });
    });
  });

  it('readProjectStatus and readProjectDiff report a real change in this session cwd', async () => {
    const env = hermeticGitEnv();
    const repo = tempDir('project-session-repo-');
    git(repo, env, 'init', '-q', '-b', 'main');
    git(repo, env, 'config', 'user.name', 'Session Test');
    git(repo, env, 'config', 'user.email', 'session@example.com');
    writeFileSync(join(repo, 'a.txt'), 'line1\nline2\n');
    git(repo, env, 'add', '--', 'a.txt');
    git(repo, env, 'commit', '-q', '-m', 'chore: base');
    writeFileSync(join(repo, 'a.txt'), 'line1\nCHANGED\n');

    await withSession(repo, async (harness) => {
      const status = await harness.session.readProjectStatus();
      if (status.kind !== 'status') throw new Error(`expected status, got ${JSON.stringify(status)}`);
      expect(status.branch).toBe('main');
      // The harness itself writes `.robota/` session state into the workspace (untracked) — filter it
      // out rather than asserting the exact file set, which is this test's business, not the harness's.
      expect(status.files.find((f) => f.path === 'a.txt')).toEqual({
        path: 'a.txt',
        status: 'Modified',
        added: 1,
        removed: 1,
      });

      const diff = await harness.session.readProjectDiff('a.txt');
      if (diff.kind !== 'diff') throw new Error(`expected diff, got ${JSON.stringify(diff)}`);
      expect(diff.diffLines.some((l) => l.type === 'remove' && l.text === 'line2')).toBe(true);
      expect(diff.diffLines.some((l) => l.type === 'add' && l.text === 'CHANGED')).toBe(true);
    });
  });

  it('readProjectDiff reports outside-workspace for a path outside the session cwd', async () => {
    const env = hermeticGitEnv();
    const repo = tempDir('project-session-repo2-');
    git(repo, env, 'init', '-q', '-b', 'main');
    await withSession(repo, async (harness) => {
      await expect(harness.session.readProjectDiff('../outside.txt')).resolves.toEqual({
        kind: 'outside-workspace',
      });
    });
  });

  it('readProjectMemory reports unavailable when no memory store was injected (the default)', async () => {
    const repo = tempDir('project-session-repo3-');
    await withSession(repo, async (harness) => {
      const memory = await harness.session.readProjectMemory();
      expect(memory.kind).toBe('unavailable');
      if (memory.kind !== 'unavailable') throw new Error('expected unavailable');
      expect(memory.message.length).toBeGreaterThan(0);
    });
  });
});
