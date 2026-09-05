import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runAdvance } from '../gate.mjs';
import { makeTemp } from './make-temp.mjs';

vi.mock('node:fs', async (original) => {
  const actual = await original();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const NAME = 'INFRA-999-completion.md';
const SPEC = `.agents/spec-docs/todo/${NAME}`;
const TASK = `.agents/tasks/${NAME}`;

function fixture() {
  const root = makeTemp('task-complete-');
  const put = (relative, text) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  };
  put(
    '.agents/rules/spec-workflow.md',
    '## Spec-Document Status and Lifecycle Folders\n\n| Status | Folder |\n| --- | --- |\n| `approved` | `.agents/spec-docs/todo/` |\n| `done` | `.agents/spec-docs/done/` |\n',
  );
  put(
    TASK,
    `---\ntitle: 'INFRA-999: Completion'\nstatus: in-progress\ncreated: 2026-09-05\n---\n\nSpec: \`${SPEC}\`\n\n## Plan\n\n- [x] Finish\n\n## Evidence Log\n\nHistorical: \`${SPEC}\`\n`,
  );
  put(
    SPEC,
    `---\nstatus: approved\ntype: INFRA\nlane: L1\n---\n\n## Completion Criteria\n\n- [x] TC-01: complete\n\n## Tasks\n\n- [x] \`${TASK}\`\n\n## Evidence Log\n\n### [GATE-DONE] — ✅ PASS | 2026-09-05\n\n- GATE-DONE — completion: fixture observed complete\n\n**Status upgrade:** approved → done\n`,
  );
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  return { root, put, read: (relative) => readFileSync(path.join(root, relative), 'utf8') };
}

describe('Task completion lifecycle', () => {
  it('routes supported completion through one command and retains explicit manual recovery', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    for (const file of [
      '.agents/tasks/README.md',
      '.agents/skills/task-tracking/SKILL.md',
      '.agents/skills/backlog-pipeline/SKILL.md',
    ]) {
      expect(readFileSync(path.join(root, file), 'utf8')).toContain('task-complete.mjs');
    }
    expect(readFileSync(path.join(root, '.agents/tasks/README.md'), 'utf8')).toContain(
      'partial paths',
    );
    const owner = readFileSync(path.join(root, '.agents/tasks/README.md'), 'utf8');
    expect(owner).toContain('L0/no-spec');
    expect(owner).toContain('Manual done completion:');
    expect(owner).toContain('`status: done` and `completed: YYYY-MM-DD`');
  });
  it('rejects outside-root and missing input without touching the pair', async () => {
    const { runComplete } = await import('../task-complete.mjs');
    const f = fixture();
    const before = f.read(SPEC);
    expect(() => runComplete({ root: f.root, doc: '../outside.md', date: '2026-09-05' })).toThrow(
      /unsafe|outside/,
    );
    expect(() =>
      runComplete({ root: f.root, doc: '.agents/spec-docs/todo/missing.md', date: '2026-09-05' }),
    ).toThrow();
    expect(f.read(SPEC)).toBe(before);
  });
  it('runs the same completion through its public CLI for a L2 COMPLETE PASS', () => {
    const f = fixture();
    f.put(
      SPEC,
      f
        .read(SPEC)
        .replace('lane: L1', 'lane: L2')
        .replaceAll('approved', 'verifying')
        .replaceAll('GATE-DONE', 'GATE-COMPLETE'),
    );
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../task-complete.mjs'),
        '--root',
        f.root,
        '--doc',
        SPEC,
        '--date',
        '2026-09-05',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).alreadyDone).toBe(false);
    expect(f.read(`.agents/tasks/completed/${NAME}`)).toContain('status: done');
  });
  it('preserves a Spec line inside historical evidence', () => {
    const f = fixture();
    f.put(TASK, f.read(TASK).replace('Historical:', 'Spec:'));
    runAdvance({ root: f.root, doc: SPEC });
    expect(f.read(TASK).split('## Evidence Log')[1]).toContain(SPEC);
  });
  it('reports an unexpected partial write failure and never returns success', async () => {
    const { runComplete } = await import('../task-complete.mjs');
    const f = fixture();
    const spy = vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('fixture rename failure');
    });
    try {
      expect(() => runComplete({ root: f.root, doc: SPEC, date: '2026-09-05' })).toThrow(
        /partial state may remain/,
      );
    } finally {
      spy.mockReset();
      spy.mockImplementation((await vi.importActual('node:fs')).renameSync);
    }
  });
  it.each([
    'collision',
    'unchecked Task',
    'unchecked TC',
    'no PASS',
    'wrong gate',
    'mismatched pointer',
    'mismatched ID',
    'symlink Task',
    'symlink archive',
    'initiative parent',
    'initiative self',
    'invalid date',
  ])('refuses %s before mutation', async (kind) => {
    const { runComplete } = await import('../task-complete.mjs');
    const f = fixture();
    if (kind === 'collision') f.put(`.agents/tasks/completed/${NAME}`, 'occupied');
    if (kind === 'unchecked Task') f.put(TASK, f.read(TASK).replace('[x]', '[ ]'));
    if (kind === 'unchecked TC') f.put(SPEC, f.read(SPEC).replace('[x]', '[ ]'));
    if (kind === 'no PASS') f.put(SPEC, f.read(SPEC).replace('✅ PASS', '❌ FAIL'));
    if (kind === 'wrong gate') f.put(SPEC, f.read(SPEC).replace('GATE-DONE', 'GATE-WRITE'));
    if (kind === 'mismatched pointer')
      f.put(TASK, f.read(TASK).replace(`Spec: \`${SPEC}\``, 'Spec: `wrong.md`'));
    if (kind === 'mismatched ID') f.put(TASK, f.read(TASK).replace('INFRA-999:', 'INFRA-998:'));
    if (kind === 'symlink Task') {
      const original = f.read(TASK);
      f.put('elsewhere.md', original);
      rmSync(path.join(f.root, TASK));
      symlinkSync(path.join(f.root, 'elsewhere.md'), path.join(f.root, TASK));
    }
    if (kind === 'symlink archive')
      symlinkSync(f.root, path.join(f.root, '.agents/tasks/completed'));
    if (kind === 'initiative parent')
      f.put(
        '.agents/tasks/AGREEMENT-999-parent.md',
        '---\nstatus: todo\nchildren: [INFRA-999]\n---\n',
      );
    if (kind === 'initiative self')
      f.put(TASK, f.read(TASK).replace('status:', 'children: [INFRA-998]\nstatus:'));
    const snapshot = () => {
      const result = {};
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.git') continue;
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) result[file] = 'symlink';
          else if (entry.isDirectory()) walk(file);
          else result[file] = readFileSync(file, 'hex');
        }
      };
      walk(f.root);
      result.index = spawnSync('git', ['ls-files', '--stage'], {
        cwd: f.root,
        encoding: 'utf8',
      }).stdout;
      return result;
    };
    const before = snapshot();
    expect(() =>
      runComplete({
        root: f.root,
        doc: SPEC,
        date: kind === 'invalid date' ? '2026-02-30' : '2026-09-05',
      }),
    ).toThrow(/refused/);
    expect(snapshot()).toEqual(before);
  });
  it('completes the pair and leaves a safe no-op on repeated completion', async () => {
    const { runComplete } = await import('../task-complete.mjs');
    const { root, read } = fixture();
    const result = runComplete({ root, doc: SPEC, date: '2026-09-05' });
    expect(result.exit).toBe(0);
    const task = `.agents/tasks/completed/${NAME}`;
    const spec = `.agents/spec-docs/done/${NAME}`;
    expect(read(task)).toContain('status: done\n');
    expect(read(task)).toContain('completed: 2026-09-05\n');
    expect(read(task)).toContain(`Historical: \`${SPEC}\``);
    expect(read(spec)).toContain(task);
    expect(runComplete({ root, doc: spec, date: '2026-09-05' }).alreadyDone).toBe(true);
  });
  it('preserves historical spec paths when advance updates the current pointer', () => {
    const { root, read } = fixture();
    runAdvance({ root, doc: SPEC });
    expect(read(TASK)).toContain(`Historical: \`${SPEC}\``);
    expect(read(TASK)).toContain(`Spec: \`.agents/spec-docs/done/${NAME}\``);
  });
});
