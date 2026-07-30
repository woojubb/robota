import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Execution coverage for the four hooks that had none.
 *
 * `hooks-have-execution-coverage` — the mechanical floor for PROC-003's third question, "is it
 * reached?" — found these on its first run: `memory-mirror-reminder`, `post-tool-format`,
 * `spec-first-gate` and `task-tracking` were described by no test and executed by none. That is the
 * shape that left `worktree-cwd-guard` switched off in every real session with ten green tests
 * beside it, so a hook nobody runs is a hook nobody has checked.
 *
 * Each case below states which signal the hook depends on and who sends it, because the floor
 * cannot judge that and the rule asks for it in writing.
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

function run(hook, { input, env = {}, cwd = WORKSPACE_ROOT } = {}) {
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
    input,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('memory-mirror-reminder', () => {
  // Signal: the PostToolUse payload's `tool_input.file_path`, sent by the tool host on every
  // Write/Edit. Nothing else is required, so a case supplies only that.
  it('reminds on a write outside the in-repo memory', () => {
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({ tool_input: { file_path: '/home/u/.claude/memory/thing.md' } }),
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output.trim().length, 'the reminder said nothing at all').toBeGreaterThan(0);
  });

  it('stays silent on a write INTO the in-repo memory', () => {
    // The compliant case is the whole point: a reminder that fires on the compliant path is one
    // everybody learns to ignore.
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({ tool_input: { file_path: '/repo/.agents/memory/thing.md' } }),
    });

    expect(verdict.status).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });
});

describe('post-tool-format', () => {
  // Signal: `tool_input.file_path` again, and the file must EXIST — the hook formats what was just
  // written. A path that does not exist is the ordinary case for a deleted or moved file.
  it('does nothing for a file that is not there', () => {
    const verdict = run('post-tool-format.sh', {
      input: JSON.stringify({ tool_input: { file_path: '/nonexistent/nowhere.ts' } }),
    });

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('does nothing at all when the project directory is unset', () => {
    // The case neither earlier test reached: the variable unset AND a real file with a formatted
    // extension. A nonexistent path and a `.txt` both exit before the scoping check, so both stayed
    // green whether or not the bare `$CLAUDE_PROJECT_DIR` crash existed — and it did, twice: once in
    // the scoping pattern and again at the `cd` four lines below it.
    //
    // Without a project directory the hook cannot tell what is in scope. `\"${CLAUDE_PROJECT_DIR:-}\"/*`
    // does not fail safe either — unset, it reduces to `/*`, which matches nearly every absolute
    // path. So it does nothing.
    const dir = scratchDir('post-format-unset-');
    const file = path.join(dir, 'thing.ts');
    writeFileSync(file, 'const a = 1\n');

    const result = spawnSync('bash', [path.join(HOOKS_DIR, 'post-tool-format.sh')], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR'),
      ),
    });

    expect(result.status ?? 1, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
    expect(`${result.stderr ?? ''}`, 'it crashed instead of standing down').not.toMatch(
      /unbound variable|바인딩 해제/,
    );
  });

  it('does nothing for a file outside the formatted set', () => {
    const dir = scratchDir('post-format-');
    const file = path.join(dir, 'notes.txt');
    writeFileSync(file, 'plain text\n');

    const verdict = run('post-tool-format.sh', {
      input: JSON.stringify({ tool_input: { file_path: file } }),
    });

    expect(verdict.status, verdict.output).toBe(0);
  });
});

describe('spec-first-gate', () => {
  // Signal: the UserPromptSubmit payload's `prompt`. The gate reads intent from the text, so the
  // cases are two prompts — one that states implementation intent without a spec reference, and one
  // that carries no such intent at all.
  it('says nothing when the prompt states no implementation intent', () => {
    const verdict = run('spec-first-gate.sh', {
      input: JSON.stringify({ prompt: 'what does this package do?' }),
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });

  it('says nothing on an empty prompt', () => {
    const verdict = run('spec-first-gate.sh', { input: JSON.stringify({ prompt: '' }) });

    expect(verdict.status).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });
});

describe('task-tracking', () => {
  // Signals: the `start`/`stop` mode argument, and a tasks directory under CLAUDE_PROJECT_DIR. Both
  // come from the deployment — the mode from `.claude/settings.json`, the directory from the repo.
  it('refuses a mode it does not handle, and says so', () => {
    // Invoked with no mode it is not a no-op — it is a misuse, and the hook names the two it takes.
    const verdict = run('task-tracking.sh', { input: '{}' });

    expect(verdict.status, verdict.output).not.toBe(0);
    expect(verdict.output).toMatch(/Usage: task-tracking\.sh <start\|stop>/);
  });

  it('does nothing when there is no tasks directory', () => {
    const dir = scratchDir('task-tracking-');
    mkdirSync(path.join(dir, '.claude'), { recursive: true });

    const result = spawnSync('bash', [path.join(HOOKS_DIR, 'task-tracking.sh'), 'start'], {
      input: '{}',
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });

    expect(result.status ?? 1, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
  });
});
