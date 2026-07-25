import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The hook under test — a PreToolUse Bash guard that blocks destructive git commands when a
// worktree-assigned subagent's cwd has silently fallen back to the MAIN checkout (HARNESS-043).
const HOOK = path.resolve(import.meta.dirname, '../../../.claude/hooks/worktree-cwd-guard.sh');

/** git init a repo at `dir` (created if needed) with an initial commit so rev-parse resolves. */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      stdio: 'pipe',
    });
  git('init', '-q');
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-q', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    stdio: 'pipe',
  });
  return dir;
}

/** Run the hook with a synthesized PreToolUse payload; returns { status, stderr }. */
function runHook({ command, cwd, env = {} }) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd,
  });
  const res = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    // Start from a scrubbed env so the marker is only present when a case sets it.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { status: res.status, stderr: res.stderr ?? '' };
}

let root;
let mainRepo;
let worktreeRepo;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wt-cwd-guard-'));
  // MAIN checkout — its toplevel path does NOT contain `.claude/worktrees/`.
  mainRepo = initRepo(path.join(root, 'mainrepo'));
  // Assigned worktree — its toplevel path DOES contain `.claude/worktrees/`.
  worktreeRepo = initRepo(path.join(root, 'mainrepo', '.claude', 'worktrees', 'agent-test'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('worktree-cwd-guard hook', () => {
  it('BLOCKS git reset --hard when cwd fell back to MAIN and a worktree marker is set', () => {
    const { status, stderr } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
    expect(stderr).toMatch(/worktree-cwd-guard/);
  });

  it('BLOCKS git clean -fdx in the same fallback context', () => {
    const { status } = runHook({
      command: 'git clean -fdx',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git checkout -- . in the same fallback context', () => {
    const { status } = runHook({
      command: 'git checkout -- .',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git push --force in the same fallback context', () => {
    const { status } = runHook({
      command: 'git push --force origin main',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('ALLOWS the same destructive command inside the assigned worktree', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: worktreeRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ALLOWS a destructive command with the inline override token', () => {
    const { status } = runHook({
      command: 'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('does not affect non-destructive git in the fallback context', () => {
    const { status } = runHook({
      command: 'git status --short',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: normal main-repo destructive work with NO worktree marker is unaffected', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: {},
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: does not block when the effective dir cannot be resolved as a git repo', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: path.join(root, 'not-a-repo'),
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ignores non-Bash tool calls', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: mainRepo });
    const res = spawnSync('bash', [HOOK], { input: payload, encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});
