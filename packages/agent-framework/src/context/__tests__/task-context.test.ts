import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverTaskFiles,
  formatTaskContext,
  loadTaskContext,
  parseTaskFile,
  selectRelevantTasks,
  updateTaskFileStatus,
} from '../task-context.js';

const TMP_BASE = join(tmpdir(), `robota-task-context-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, '.agents', 'tasks'), { recursive: true });
  return dir;
}

function writeTask(cwd: string, name: string, content: string): string {
  const path = join(cwd, '.agents', 'tasks', name);
  writeFileSync(path, content, 'utf8');
  return path;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) {
    rmSync(TMP_BASE, { recursive: true, force: true });
  }
});

describe('task context loading', () => {
  it('discovers direct task markdown files and excludes README and completed tasks', () => {
    const cwd = makeProject();
    writeTask(cwd, 'CLI-BL-001-example.md', '# CLI-BL-001');
    writeTask(cwd, 'README.md', '# Tasks');
    mkdirSync(join(cwd, '.agents', 'tasks', 'completed'), { recursive: true });
    writeFileSync(join(cwd, '.agents', 'tasks', 'completed', 'DONE.md'), '# Done', 'utf8');

    expect(discoverTaskFiles(cwd).map((path) => path.replace(cwd, ''))).toEqual([
      '/.agents/tasks/CLI-BL-001-example.md',
    ]);
  });

  it('parses task metadata, objective, and unchecked completion items', () => {
    const cwd = makeProject();
    const path = writeTask(
      cwd,
      'CLI-BL-001-example.md',
      [
        '# CLI-BL-001: Example',
        '',
        '- **Status**: in-progress',
        '- **Branch**: feat/example',
        '- **Scope**: packages/agent-sdk',
        '',
        '## Objective',
        '',
        'Inject task context.',
        '',
        '## Requirements for Completion (Definition of Done)',
        '',
        '- [ ] Load task files',
        '- [x] Ignore completed work',
      ].join('\n'),
    );

    expect(parseTaskFile(path, cwd)).toMatchObject({
      title: 'CLI-BL-001: Example',
      relativePath: '.agents/tasks/CLI-BL-001-example.md',
      status: 'in-progress',
      branch: 'feat/example',
      scope: 'packages/agent-sdk',
      objective: 'Inject task context.',
      openItems: ['Load task files'],
    });
  });

  it('selects current-branch tasks before other active tasks and respects the max task count', () => {
    const cwd = makeProject();
    const first = parseTaskFile(
      writeTask(cwd, 'A.md', '# A\n\n- **Status**: todo\n- **Branch**: feat/other\n'),
      cwd,
    );
    const second = parseTaskFile(
      writeTask(cwd, 'B.md', '# B\n\n- **Status**: in-progress\n- **Branch**: feat/current\n'),
      cwd,
    );
    const third = parseTaskFile(writeTask(cwd, 'C.md', '# C\n\n- **Status**: in-progress\n'), cwd);

    expect(
      selectRelevantTasks([first, third, second], {
        currentBranch: 'feat/current',
        maxTasks: 2,
      }).map((task) => task.title),
    ).toEqual(['B', 'C']);
  });

  it('formats selected tasks as neutral markdown without behavior instructions', () => {
    const cwd = makeProject();
    const task = parseTaskFile(
      writeTask(
        cwd,
        'CLI-BL-001-example.md',
        [
          '# CLI-BL-001: Example',
          '- **Status**: in-progress',
          '- **Branch**: feat/example',
          '## Objective',
          'Keep the agent focused.',
          '## Requirements for Completion',
          '- [ ] Verify prompt output',
        ].join('\n'),
      ),
      cwd,
    );

    const formatted = formatTaskContext([task]);

    expect(formatted).toContain('### CLI-BL-001: Example');
    expect(formatted).toContain('- **Path:** `.agents/tasks/CLI-BL-001-example.md`');
    expect(formatted).toContain('- **Objective:** Keep the agent focused.');
    expect(formatted).toContain('- Verify prompt output');
    expect(formatted).not.toContain('you must');
    expect(formatted).not.toContain('Always');
  });

  it('loads bounded task context for the current project', () => {
    const cwd = makeProject();
    writeTask(cwd, 'CLI-BL-001-example.md', '# CLI-BL-001\n\n- **Status**: in-progress\n');

    const context = loadTaskContext(cwd, { maxTasks: 3 });

    expect(context).toContain('CLI-BL-001');
  });
});

describe('updateTaskFileStatus', () => {
  it('updates existing status and appends deterministic progress text', () => {
    const cwd = makeProject();
    const path = writeTask(
      cwd,
      'CLI-BL-001-example.md',
      '# CLI-BL-001\n\n- **Status**: todo\n\n## Progress\n',
    );

    updateTaskFileStatus(path, 'completed', {
      now: new Date('2026-05-02T00:00:00.000Z'),
      progressMessage: 'Completed task context injection.',
    });

    expect(readFileSync(path, 'utf8')).toContain('- **Status**: completed');
    expect(readFileSync(path, 'utf8')).toContain('### 2026-05-02');
    expect(readFileSync(path, 'utf8')).toContain('- Completed task context injection.');
  });

  it('inserts a status line when a task has no metadata block yet', () => {
    const cwd = makeProject();
    const path = writeTask(cwd, 'CLI-BL-001-example.md', '# CLI-BL-001\n\n## Objective\nWork\n');

    updateTaskFileStatus(path, 'in-progress', {
      now: new Date('2026-05-02T00:00:00.000Z'),
    });

    expect(readFileSync(path, 'utf8').startsWith('# CLI-BL-001\n\n- **Status**: in-progress')).toBe(
      true,
    );
  });
});
