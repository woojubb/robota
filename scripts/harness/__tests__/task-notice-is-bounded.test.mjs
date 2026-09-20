/**
 * INFRA-2772 — the SessionStart Task notice lists what its own instruction is true for.
 *
 * `task-tracking.sh start` used to print one `— in progress` line per open Task file, unbounded:
 * 166 files, 14,855 bytes, 122 of them `status: todo`, injected at every session start and after
 * every compaction. These cases pin the three properties the fix has to keep to be worth having:
 * a `todo` Task is counted and not listed, the in-progress list is capped and SAYS it is capped, and
 * the lines that are instructions rather than inventory (DONE, INVALID) are never cut.
 *
 * The classifier's one-process directory mode is pinned by shape so the hook's single `node` spawn
 * cannot quietly become one-per-file again.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/task-tracking.sh');
const LIFECYCLE = path.join(WORKSPACE_ROOT, 'scripts/harness/task-lifecycle.mjs');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function repoWithTasks(files) {
  const dir = makeTemp('task-notice-');
  scratch.push(dir);
  const tasks = path.join(dir, '.agents', 'tasks');
  mkdirSync(tasks, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(tasks, name), body);
  return dir;
}

function run(dir, mode, { bash = 'bash', env = {} } = {}) {
  const result = spawnSync(bash, [HOOK, mode], {
    input: '{}',
    encoding: 'utf8',
    cwd: dir,
    // The open-issue block is a network call with its own tests; this file is about the Task block.
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TASK_TRACKING_SKIP_ISSUES: '1', ...env },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
const start = (dir, options) => run(dir, 'start', options);

/**
 * A PATH whose first `node` is a stub that fails — the classifier "could not run" case. The stub
 * exits with a distinctive status and one stderr line so the case can check both are surfaced.
 */
function pathWithFailingNode() {
  const dir = makeTemp('failing-node-');
  scratch.push(dir);
  writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho "stub node: refusing" >&2\nexit 3\n');
  chmodSync(path.join(dir, 'node'), 0o755);
  return `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
}

const task = (status) => `---\nstatus: ${status}\n---\n# A task\n\n- [ ] something\n`;

describe('task-tracking start — the Task block is bounded to what is in progress', () => {
  it('counts a todo Task and does not list it; lists an in-progress one', () => {
    const dir = repoWithTasks({
      'A-TODO.md': task('todo'),
      'B-WORK.md': task('in-progress'),
      'C-TODO.md': task('todo'),
    });
    const verdict = start(dir);

    expect(verdict.status).toBe(0);
    expect(verdict.output).toMatch(/B-WORK\.md — in progress/);
    expect(verdict.output, 'a todo Task was listed as an entry').not.toMatch(/A-TODO\.md/);
    expect(verdict.output).not.toMatch(/C-TODO\.md/);
    expect(verdict.output).toMatch(/3 open — 1 in-progress, 0 blocked, 2 todo/);
    expect(verdict.output).toMatch(/2 todo Task\(s\) are not listed/);
  });

  it('lists a blocked Task as blocked, after the in-progress ones', () => {
    const dir = repoWithTasks({
      'A-BLOCKED.md': task('blocked'),
      'B-WORK.md': task('in-progress'),
    });
    const { output } = start(dir);

    expect(output).toMatch(/A-BLOCKED\.md — blocked/);
    expect(output.indexOf('B-WORK.md — in progress')).toBeLessThan(
      output.indexOf('A-BLOCKED.md — blocked'),
    );
  });

  it('caps the list at 20 and says so — a bounded list that does not announce its bound is the defect', () => {
    const files = {};
    for (let i = 1; i <= 21; i += 1)
      files[`T-${String(i).padStart(2, '0')}.md`] = task('in-progress');
    const { output } = start(repoWithTasks(files));

    const entries = output.match(/^ {2}- T-\d\d\.md — in progress$/gm) ?? [];
    expect(entries, 'more than the cap was printed').toHaveLength(20);
    expect(output).toMatch(/showing the first 20 of 21/);
  });

  it('prints no bound line when the list fits', () => {
    const { output } = start(repoWithTasks({ 'T-01.md': task('in-progress') }));
    expect(output).not.toMatch(/showing the first/);
  });

  it('never cuts the DONE and INVALID lines — they are instructions, not inventory', () => {
    const files = { 'Z-BAD.md': '# no frontmatter at all\n' };
    for (let i = 1; i <= 25; i += 1)
      files[`T-${String(i).padStart(2, '0')}.md`] = task('in-progress');
    files['Y-DONE.md'] = '---\nstatus: done\ncompleted: 2026-08-14\n---\n# Done\n';
    const { output } = start(repoWithTasks(files));

    expect(output).toMatch(/Y-DONE\.md — DONE, needs archival/);
    expect(output).toMatch(/Z-BAD\.md — INVALID lifecycle frontmatter/);
    expect(output).toMatch(/1 task\(s\) are already DONE/);
  });

  it('still says something, and exits 0, when every open Task is todo', () => {
    const verdict = start(repoWithTasks({ 'A.md': task('todo'), 'B.md': task('todo') }));

    expect(verdict.status).toBe(0);
    expect(verdict.output).toMatch(/2 open — 0 in-progress, 0 blocked, 2 todo/);
    expect(verdict.output).not.toMatch(/— in progress/);
  });

  it('says the classifier could not run — not "0 open", not "INVALID frontmatter" — in both modes', () => {
    // Review measured the first version with `node` off PATH: a `0 open — 0/0/0` headline that was
    // false, then every Task called INVALID frontmatter when no frontmatter had been read. "Could not
    // classify" and "classified as invalid" are different answers.
    const dir = repoWithTasks({ 'A.md': task('in-progress'), 'B.md': task('todo') });
    const env = { PATH: pathWithFailingNode() };

    const started = run(dir, 'start', { env });
    expect(started.status).toBe(0);
    expect(started.output).toMatch(
      /Could not classify Task files: .*classify-dir exited 3 \(stub node: refusing\)/,
    );
    expect(started.output).toMatch(/2 \.md file\(s\) in \.agents\/tasks\/ were NOT classified/);
    expect(started.output, 'a false count was printed').not.toMatch(/0 open/);
    expect(started.output, 'unread files were called invalid').not.toMatch(
      /INVALID lifecycle frontmatter/,
    );

    const stopped = run(dir, 'stop', { env });
    expect(stopped.status).toBe(0);
    expect(stopped.output).toMatch(/Could not classify Task files/);
    expect(stopped.output).not.toMatch(/ACTION REQUIRED/);
  });

  it('tells an unreadable file apart from invalid frontmatter', () => {
    // root reads a mode-000 file anyway, so the case cannot be expressed there.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = repoWithTasks({ 'A-LOCKED.md': task('in-progress'), 'B.md': task('in-progress') });
    chmodSync(path.join(dir, '.agents/tasks/A-LOCKED.md'), 0o000);
    try {
      const { output } = start(dir);
      expect(output).toMatch(/A-LOCKED\.md — could not be READ/);
      expect(output).not.toMatch(/A-LOCKED\.md — INVALID/);
      expect(output).toMatch(/B\.md — in progress/);
    } finally {
      chmodSync(path.join(dir, '.agents/tasks/A-LOCKED.md'), 0o644);
    }
  });

  // `#!/bin/bash` resolves to bash 3.2 on a stock macOS, where `"${arr[@]}"` on an empty array is an
  // unbound-variable error under `set -u`. PATH bash is 5.x everywhere the suite runs, so without
  // this pass the guards in the hook are exercised by no test.
  const stockBash = '/bin/bash';
  it.skipIf(process.platform !== 'darwin' || !existsSync(stockBash))(
    'behaves the same under the stock macOS bash 3.2',
    () => {
      const files = { 'Z-BAD.md': '# no frontmatter\n' };
      for (let i = 1; i <= 21; i += 1)
        files[`T-${String(i).padStart(2, '0')}.md`] = task('in-progress');
      const dir = repoWithTasks(files);
      const version = spawnSync(stockBash, ['-c', 'echo "${BASH_VERSINFO[0]}"'], {
        encoding: 'utf8',
      });
      expect(version.stdout.trim()).toBe('3');

      const started = run(dir, 'start', { bash: stockBash });
      expect(started.status).toBe(0);
      expect(started.output).not.toMatch(/unbound variable/);
      expect(started.output.match(/^ {2}- T-\d\d\.md — in progress$/gm) ?? []).toHaveLength(20);
      expect(started.output).toMatch(/showing the first 20 of 21/);
      expect(started.output).toMatch(/Z-BAD\.md — INVALID lifecycle frontmatter/);

      const empty = run(repoWithTasks({ 'A.md': task('todo') }), 'stop', { bash: stockBash });
      expect(empty.status).toBe(0);
      expect(empty.output).not.toMatch(/unbound variable/);
    },
  );
});

describe('task-lifecycle.mjs classify-dir — one process for the whole directory', () => {
  it('reports a file it could not read as unreadable, not invalid', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = repoWithTasks({ 'A.md': task('todo') });
    const file = path.join(dir, '.agents/tasks/A.md');
    chmodSync(file, 0o000);
    try {
      const result = spawnSync('node', [LIFECYCLE, 'classify-dir', path.dirname(file)], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trimEnd()).toBe('A.md\tunreadable\t-');
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('prints name, state and status per file, sorted, skipping README.md', () => {
    const dir = repoWithTasks({
      'README.md': '# not a task\n',
      'B.md': task('in-progress'),
      'A.md': '---\nstatus: done\ncompleted: 2026-08-14\n---\n',
      'C.md': '# no frontmatter\n',
      'D.md': task('blocked'),
    });
    const result = spawnSync('node', [LIFECYCLE, 'classify-dir', path.join(dir, '.agents/tasks')], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toEqual([
      'A.md\tterminal\tdone',
      'B.md\topen\tin-progress',
      'C.md\tinvalid\t-',
      'D.md\topen\tblocked',
    ]);
  });

  it('keeps `classify <file>` as it was', () => {
    const dir = repoWithTasks({ 'B.md': task('in-progress') });
    const result = spawnSync(
      'node',
      [LIFECYCLE, 'classify', path.join(dir, '.agents/tasks/B.md')],
      {
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('open');
  });
});
