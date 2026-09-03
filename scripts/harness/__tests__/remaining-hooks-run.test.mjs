import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  const dir = makeTemp(prefix);
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

  // Issue #2271: the documented way to edit files in this repository is Bash, and a heredoc, `tee`,
  // `cp` or `sed -i` carries no `file_path` — six durable lessons sat unmirrored because every one
  // was written that way. Signal: the PostToolUse payload's `tool_input.command`, sent by the tool
  // host on every Bash call, under the `Bash` matcher added beside the Write/Edit one.
  it('reminds on a Bash heredoc redirected into host memory', () => {
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: {
          command: "cat > ~/.claude/projects/p/memory/lesson.md <<'EOF'\n# lesson\nEOF",
        },
      }),
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toContain('/.claude/projects/p/memory/lesson.md');
  });

  it('reminds on a Bash cp whose quoted target is host memory', () => {
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'cp notes.md "$HOME/.claude/memory/notes.md"' },
      }),
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toContain('/.claude/memory/notes.md');
  });

  it('stays silent on a Bash READ of host memory', () => {
    // A reminder that fires on `cat` is one everybody learns to ignore — same reason as the in-repo
    // case above.
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'cat ~/.claude/memory/thing.md' },
      }),
    });

    expect(verdict.status).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });

  it('stays silent on a Bash write INTO the in-repo memory', () => {
    const verdict = run('memory-mirror-reminder.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: "tee .agents/memory/thing.md <<'EOF'\nfact\nEOF" },
      }),
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

  it('reaches the extension filter, and the filter decides', () => {
    // This case asserted exit 0 for a `.txt` without setting CLAUDE_PROJECT_DIR — so the new
    // stand-down guard exited first and the extension filter was never reached. Deleting that filter
    // entirely would have left the test green: the described-but-not-reached shape, in the file
    // written to close it.
    //
    // `npx` is stubbed to leave a marker, so "the filter let it through" is observable rather than
    // inferred from an exit code both paths share.
    const dir = scratchDir('post-format-filter-');
    const bin = scratchDir('npx-stub-');
    const marker = path.join(dir, 'npx-ran');
    writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(marker)}\n`);
    chmodSync(path.join(bin, 'npx'), 0o755);

    const formatted = path.join(dir, 'thing.ts');
    const ignored = path.join(dir, 'notes.txt');
    writeFileSync(formatted, 'const a = 1\n');
    writeFileSync(ignored, 'plain text\n');

    const call = (file) =>
      spawnSync('bash', [path.join(HOOKS_DIR, 'post-tool-format.sh')], {
        input: JSON.stringify({ tool_input: { file_path: file } }),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: dir },
      });

    expect(call(ignored).status ?? 1).toBe(0);
    expect(existsSync(marker), 'an unsupported extension was handed to the formatter').toBe(false);

    expect(call(formatted).status ?? 1).toBe(0);
    expect(existsSync(marker), 'a supported extension never reached the formatter').toBe(true);
  });
});

describe('spec-first-gate', () => {
  // Signal: the UserPromptSubmit payload's `prompt`. The gate reads intent from the text, so the
  // cases are prompts.
  it('injects the gate when a prompt states implementation intent without a spec', () => {
    // The case the earlier pair claimed and did not reach: both of those took the silent path, so
    // breaking the intent match or deleting the SPEC-GATE block entirely would have left them green.
    const verdict = run('spec-first-gate.sh', {
      input: JSON.stringify({ prompt: 'implement the retry queue for the worker' }),
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output, 'the gate said nothing about implementation intent').toMatch(
      /SPEC-GATE/,
    );
  });

  it('stays quiet when the prompt already refers to a spec', () => {
    // The other half of the same branch: a prompt that names a spec has already done what the gate
    // asks for, and a gate that fires anyway is one people learn to scroll past.
    const verdict = run('spec-first-gate.sh', {
      input: JSON.stringify({ prompt: 'implement the retry queue per its spec-doc' }),
    });

    expect(verdict.status).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });

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
  function repoWithTasks(files) {
    const dir = scratchDir('task-tracking-');
    const tasks = path.join(dir, '.agents', 'tasks');
    mkdirSync(tasks, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(tasks, name), body);
    }
    return dir;
  }

  function track(dir, mode) {
    const result = spawnSync('bash', [path.join(HOOKS_DIR, 'task-tracking.sh'), mode], {
      input: '{}',
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  it('classifies what is in the directory, open from finished', () => {
    // The hook's actual job, which the guard-clause cases never reached. It lists both, and the
    // classification is the content: an unchecked box is open work, `status: completed` is work that
    // needs archiving. Asserting only that a name appears would pass with the classifier deleted.
    const dir = repoWithTasks({
      'TASK-1.md': '---\nstatus: in-progress\n---\n# One\n\n- [ ] still to do\n',
      'TASK-2.md': '---\nstatus: done\ncompleted: 2026-08-14\n---\n# Two\n\n- [ ] leftover\n',
    });
    const verdict = track(dir, 'start');

    expect(verdict.output, 'the open task went unmentioned').toMatch(/TASK-1/);
    expect(verdict.output, 'the open task was called finished').not.toMatch(/TASK-1\.md — DONE/);
    expect(verdict.output, 'a finished task was not marked for archival').toMatch(
      /TASK-2\.md — DONE/,
    );
  });

  it('does not call body prose completed', () => {
    const dir = repoWithTasks({
      'TASK-1.md': '---\nstatus: in-progress\n---\n# One\n\nStatus: completed\n',
    });
    const verdict = track(dir, 'start');
    expect(verdict.output).toMatch(/TASK-1\.md — in progress/);
    expect(verdict.output).not.toMatch(/TASK-1\.md — DONE/);
  });

  it('refuses a mode it does not handle, and says so', () => {
    // Invoked with no mode it is not a no-op — it is a misuse, and the hook names the two it takes.
    const verdict = run('task-tracking.sh', { input: '{}' });

    expect(verdict.status, verdict.output).not.toBe(0);
    expect(verdict.output).toMatch(/Usage: task-tracking\.sh <start\|stop>/);
  });

  it('does nothing when there is no tasks directory', () => {
    const dir = scratchDir('task-tracking-empty-');
    mkdirSync(path.join(dir, '.claude'), { recursive: true });

    expect(track(dir, 'start').status).toBe(0);
  });
});
