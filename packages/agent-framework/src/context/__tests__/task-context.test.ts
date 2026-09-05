import { existsSync, mkdirSync, rmSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverTaskFiles,
  formatTaskContext,
  loadTaskContext,
  parseTaskFile,
  selectRelevantTasks,
} from '../task-context.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../../workspace-trust/index.js';

import type { IWorkspaceProjectReader } from '../../workspace-trust/index.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-task-context-')));

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, '.agents', 'tasks'), { recursive: true });
  return dir;
}

function writeTask(cwd: string, name: string, content: string): string {
  const relativePath = join('.agents', 'tasks', name);
  writeFileSync(join(cwd, relativePath), content, 'utf8');
  return relativePath;
}

async function projectReader(cwd: string): Promise<IWorkspaceProjectReader> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
  return getWorkspaceProjectReader(access.authority);
}

afterEach(() => {
  if (existsSync(TMP_BASE)) {
    rmSync(TMP_BASE, { recursive: true, force: true });
  }
});

describe('task context loading', () => {
  it('discovers direct task markdown files and excludes README and completed tasks', async () => {
    const cwd = makeProject();
    writeTask(cwd, 'CLI-BL-001-example.md', '# CLI-BL-001');
    writeTask(cwd, 'README.md', '# Tasks');
    mkdirSync(join(cwd, '.agents', 'tasks', 'completed'), { recursive: true });
    writeFileSync(join(cwd, '.agents', 'tasks', 'completed', 'DONE.md'), '# Done', 'utf8');

    expect(discoverTaskFiles(await projectReader(cwd))).toEqual([
      '.agents/tasks/CLI-BL-001-example.md',
    ]);
  });

  it('parses task metadata, objective, and unchecked completion items', async () => {
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

    expect(parseTaskFile(path, await projectReader(cwd))).toMatchObject({
      title: 'CLI-BL-001: Example',
      relativePath: '.agents/tasks/CLI-BL-001-example.md',
      status: 'in-progress',
      branch: 'feat/example',
      scope: 'packages/agent-sdk',
      objective: 'Inject task context.',
      openItems: ['Load task files'],
    });
  });

  it('selects current-branch tasks before other active tasks and respects the max task count', async () => {
    const cwd = makeProject();
    const reader = await projectReader(cwd);
    const first = parseTaskFile(
      writeTask(cwd, 'A.md', '# A\n\n- **Status**: todo\n- **Branch**: feat/other\n'),
      reader,
    );
    const second = parseTaskFile(
      writeTask(cwd, 'B.md', '# B\n\n- **Status**: in-progress\n- **Branch**: feat/current\n'),
      reader,
    );
    const third = parseTaskFile(
      writeTask(cwd, 'C.md', '# C\n\n- **Status**: in-progress\n'),
      reader,
    );

    expect(
      selectRelevantTasks([first, third, second], {
        currentBranch: 'feat/current',
        maxTasks: 2,
      }).map((task) => task.title),
    ).toEqual(['B', 'C']);
  });

  it('formats selected tasks as neutral markdown without behavior instructions', async () => {
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
      await projectReader(cwd),
    );

    const formatted = formatTaskContext([task]);

    expect(formatted).toContain('### CLI-BL-001: Example');
    expect(formatted).toContain('- **Path:** `.agents/tasks/CLI-BL-001-example.md`');
    expect(formatted).toContain('- **Objective:** Keep the agent focused.');
    expect(formatted).toContain('- Verify prompt output');
    expect(formatted).not.toContain('you must');
    expect(formatted).not.toContain('Always');
  });

  it('loads bounded task context for the current project', async () => {
    const cwd = makeProject();
    writeTask(cwd, 'CLI-BL-001-example.md', '# CLI-BL-001\n\n- **Status**: in-progress\n');

    const context = loadTaskContext(await projectReader(cwd), { maxTasks: 3 });

    expect(context).toContain('CLI-BL-001');
  });
});
