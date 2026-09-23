import { mkdirSync, rmSync, writeFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { SettingsSchema } from '../../config/config-types.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../../workspace-trust/index.js';
import { loadContext } from '../context-loader.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-task-context-opt-in-')));

function makeWorkspace(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTaskFile(dir: string, tasksDir = join('.agents', 'tasks')): void {
  const tasks = join(dir, tasksDir);
  mkdirSync(tasks, { recursive: true });
  writeFileSync(
    join(tasks, 'T-001-sample.md'),
    '# Sample Task\n\n- **Status**: in-progress\n\n## Objective\n\nDo the thing.\n',
    'utf8',
  );
}

async function projectSource(root: string) {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
  return { reader: getWorkspaceProjectReader(access.authority) };
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

/**
 * NEUT-004 — `.agents/tasks` house-schema context injection is opt-out-able and
 * configurable; the default preserves today's behavior.
 */
describe('NEUT-004 task-context injection discipline', () => {
  it('default behavior unchanged: task files are loaded into taskContext', async () => {
    const cwd = makeWorkspace();
    writeTaskFile(cwd);

    const context = await loadContext(await projectSource(cwd));

    expect(context.taskContext).toContain('Sample Task');
  });

  it('disabled ⇒ no task section injected even when task files exist', async () => {
    const cwd = makeWorkspace();
    writeTaskFile(cwd);

    const context = await loadContext(await projectSource(cwd), undefined, {
      taskContext: { enabled: false },
    });

    expect(context.taskContext).toBeUndefined();
  });

  it('a custom dir replaces the default .agents/tasks scan location', async () => {
    const cwd = makeWorkspace();
    writeTaskFile(cwd, 'my-tasks');
    // A decoy in the default location must NOT be read when dir is overridden.
    const decoyDir = join(cwd, '.agents', 'tasks');
    mkdirSync(decoyDir, { recursive: true });
    writeFileSync(join(decoyDir, 'D-001-decoy.md'), '# Decoy Task\n\n- **Status**: todo\n', 'utf8');

    const context = await loadContext(await projectSource(cwd), undefined, {
      taskContext: { dir: 'my-tasks' },
    });

    expect(context.taskContext).toContain('Sample Task');
    expect(context.taskContext).not.toContain('Decoy Task');
  });

  it('settings schema accepts the taskContext toggle', () => {
    const parsed = SettingsSchema.parse({ taskContext: { enabled: false, dir: 'my-tasks' } });
    expect(parsed.taskContext).toEqual({ enabled: false, dir: 'my-tasks' });
  });
});
