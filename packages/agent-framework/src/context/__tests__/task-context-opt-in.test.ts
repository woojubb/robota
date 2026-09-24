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
 * NEUT-004 — project task context is admitted only from an explicit host-selected root.
 */
describe('NEUT-004 task-context injection discipline', () => {
  it('does not scan an ambient task directory without a host-selected root', async () => {
    const cwd = makeWorkspace();
    writeTaskFile(cwd);

    const context = await loadContext(await projectSource(cwd));

    expect(context.taskContext).toBeUndefined();
  });

  it('disabled ⇒ no task section injected even when task files exist', async () => {
    const cwd = makeWorkspace();
    writeTaskFile(cwd);

    const context = await loadContext(await projectSource(cwd), undefined, {
      taskContext: { enabled: false },
    });

    expect(context.taskContext).toBeUndefined();
  });

  it('loads only the custom host-selected directory', async () => {
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
