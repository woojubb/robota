import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { makeTemp } from './make-temp.mjs';

import { describe, expect, it } from 'vitest';

import { classifyTaskFile, findTaskArchivalFindings, main } from '../check-task-archival.mjs';
import { ADVISORY_MARKER } from '../run-all-scans.mjs';

// allow-missing-artifact-file: this suite creates every Task/spec path inside disposable fixtures.

describe('classifyTaskFile', () => {
  it('does not infer terminal lifecycle from checked boxes or a done spec', () => {
    const content = [
      '# PRESET-006: something',
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '## Plan',
      '- [x] TC-01',
      '- [x] TC-02',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(false);
    expect(result.exemptReason).toBeNull();
    expect(result.reason).toBe('');
  });

  it('does not flag when a checkbox is still unchecked', () => {
    const content = [
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '- [x] TC-01',
      '- [ ] TC-02',
    ].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('classifies an all-checked file whose spec is still in todo/active as gates-overdue', () => {
    // Lesson (2026-07-02): fully-checked tasks sat invisible while their specs never left active/ —
    // the archivable rule required the spec to already be in done/, which is exactly what was overdue.
    const content = ['Spec: `.agents/spec-docs/active/X-001.md`', '- [x] TC-01'].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(false);
    expect(result.gatesOverdue).toBe(true);
    expect(result.reason).toContain('not reached spec-docs/done/');
  });

  it('does not classify gates-overdue while a checkbox is still open', () => {
    const content = ['Spec: `.agents/spec-docs/active/X-001.md`', '- [x] a', '- [ ] b'].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(false);
    expect(result.gatesOverdue).toBe(false);
  });

  it('honors archival-exempt for a gates-overdue file', () => {
    const content = [
      'Spec: `.agents/spec-docs/active/X-001.md`',
      '<!-- archival-exempt: verification blocked on external dependency -->',
      '- [x] TC-01',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.gatesOverdue).toBe(true);
    expect(result.exemptReason).toBe('verification blocked on external dependency');
  });

  it('ignores a body-level Status: completed line', () => {
    const content = ['# Task', '- **Status**: completed', 'No checkboxes here.'].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(false);
    expect(result.reason).toBe('');
  });

  it('does not flag an in-progress status', () => {
    const content = ['- **Status**: in-progress', '- [x] TC-01'].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('treats an archival-exempt annotation as an exemption, not a finding', () => {
    const content = [
      '---',
      'status: done',
      'completed: 2026-08-14',
      '---',
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '<!-- archival-exempt: blocked on dependent task PRESET-099 -->',
      '- [x] TC-01',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.exemptReason).toBe('blocked on dependent task PRESET-099');
  });

  it('ignores a file with no checkboxes and no status', () => {
    expect(classifyTaskFile('# Notes\nSome prose, no checkboxes.').archivable).toBe(false);
  });

  it('uses terminal frontmatter as the only archival signal', () => {
    const content = [
      '---',
      'status: done',
      'completed: 2026-08-14',
      '---',
      '- [ ] body state does not override lifecycle',
    ].join('\n');
    expect(classifyTaskFile(content)).toMatchObject({ archivable: true, reason: 'status: done' });
  });
});

/**
 * HARNESS-063 — the scan says how much it examined.
 *
 * Measured on this repository 2026-08-01: `0` active task files and `422` archived ones, and
 * `task-archival scan passed.` was the entire output. The two halves are reported separately
 * because the archive is what made the pass look populated.
 */
describe('the examined count', () => {
  const ARCHIVABLE = [
    '---',
    'status: done',
    'completed: 2026-08-14',
    '---',
    'Spec: `.agents/spec-docs/done/X-001.md`',
    '- [x] TC-01',
  ].join('\n');
  const OPEN = [
    '---',
    'status: in-progress',
    '---',
    'Spec: `.agents/spec-docs/active/X-002.md`',
    '- [ ] TC-01',
  ].join('\n');

  async function tasksFixture(files) {
    const root = makeTemp('robota-task-archival-');
    mkdirSync(path.join(root, '.agents/tasks/completed'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    return root;
  }

  async function run(root) {
    const lines = [];
    const code = await main(root, (line) => lines.push(line));
    return { code, output: lines.join('') };
  }

  it('reports N for a fixture holding N active task files, and the archive separately', async () => {
    const root = await tasksFixture({
      '.agents/tasks/README.md': '# Tasks\n',
      '.agents/tasks/A-001.md': OPEN,
      '.agents/tasks/A-002.md': OPEN,
      '.agents/tasks/A-003.md': OPEN,
      '.agents/tasks/completed/OLD-001.md': ARCHIVABLE,
      '.agents/tasks/completed/OLD-002.md': ARCHIVABLE,
    });

    const { examined, archived } = await findTaskArchivalFindings(root);
    expect(examined).toBe(3);
    expect(archived).toBe(2);

    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toContain(
      'task-archival scan passed (3 active task file(s) examined, 2 archived in .agents/tasks/completed/)',
    );
    expect(output).not.toContain(ADVISORY_MARKER);
  });

  it('reports 0 — and raises an advisory — rather than staying silent over an empty active half', async () => {
    const root = await tasksFixture({
      '.agents/tasks/README.md': '# Tasks\n',
      '.agents/tasks/completed/OLD-001.md': ARCHIVABLE,
    });

    const { examined, archived } = await findTaskArchivalFindings(root);
    expect(examined).toBe(0);
    expect(archived).toBe(1);

    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toContain('(0 active task file(s) examined, 1 archived');
    expect(output).toContain(`${ADVISORY_MARKER} task-archival examined 0 active task files`);
  });

  it('still fails on a done-but-active file, and names the count it read', async () => {
    const root = await tasksFixture({ '.agents/tasks/A-001.md': ARCHIVABLE });
    const { code, output } = await run(root);
    expect(code).toBe(1);
    expect(output).toContain('task-archival scan failed (1 active task file(s) examined');
    expect(output).toContain('.agents/tasks/A-001.md');
  });

  it('refuses an unreadable archive instead of reporting it as nothing archived', async () => {
    // Review of #1561, and the same defect the active half already carries a guard for: a bare
    // `catch { return 0 }` reports a permission or I/O failure in the words of a clean result. The
    // count exists to tell a reader how much was actually looked at, so a count that silently
    // becomes 0 when the read fails is worse than no count at all -- it looks measured.
    // Red-proved 2026-08-01: with the bare catch restored, this case reported 0 archived and passed.
    const root = await tasksFixture({
      '.agents/tasks/README.md': '# Tasks\n',
      '.agents/tasks/completed/OLD-001.md': ARCHIVABLE,
    });
    const archive = path.join(root, '.agents/tasks/completed');
    const fsp = await import('node:fs/promises');
    chmodSync(archive, 0o000);
    try {
      // Running as root defeats the permission bit; skip rather than assert something untrue.
      let readable = true;
      try {
        await fsp.readdir(archive);
      } catch {
        readable = false;
      }
      if (readable) return;

      await expect(
        findTaskArchivalFindings(root),
        'an unreadable archive was reported as 0 archived',
      ).rejects.toThrow(/EACCES|permission denied/i);
    } finally {
      chmodSync(archive, 0o755);
    }
  });
});

describe('AGREEMENT child lifecycle projections', () => {
  const childRow = (checked, id, status, taskPath) =>
    `- [${checked ? 'x' : ' '}] ${id} — ${status} — \`${taskPath}\``;

  async function agreementFixture({
    children = ['CHILD-001', 'CHILD-002'],
    taskRows,
    specRows,
    parentStatus = 'in-progress',
    parentCompleted,
    archivedParent = false,
    child2Status = 'in-progress',
  } = {}) {
    const root = makeTemp('robota-task-agreement-');
    const parentDir = archivedParent ? '.agents/tasks/completed' : '.agents/tasks';
    const specDir = archivedParent ? '.agents/spec-docs/done' : '.agents/spec-docs/active';
    const parentTask = `${parentDir}/AGREEMENT-900-parent.md`;
    const parentSpec = `${specDir}/AGREEMENT-900-parent.md`;
    const child1Path = '.agents/tasks/completed/CHILD-001-done.md';
    const child2Terminal = ['done', 'wontfix', 'skipped', 'superseded'].includes(child2Status);
    const child2Path = `${child2Terminal ? '.agents/tasks/completed' : '.agents/tasks'}/CHILD-002-open.md`;
    const defaultRows = [
      childRow(true, 'CHILD-001', 'done', child1Path),
      childRow(child2Terminal, 'CHILD-002', child2Status, child2Path),
    ];
    const files = {
      [parentTask]: [
        '---',
        `status: ${parentStatus}`,
        ...(parentCompleted ? [`completed: ${parentCompleted}`] : []),
        `children: [${children.join(', ')}]`,
        '---',
        '# Parent',
        '## Children',
        ...(taskRows ?? defaultRows),
      ].join('\n'),
      [parentSpec]: [
        '---',
        `status: ${archivedParent ? 'done' : 'in-progress'}`,
        'type: AGREEMENT',
        'tags: [test]',
        '---',
        '# Parent spec',
        '## Tasks',
        ...(specRows ?? defaultRows),
      ].join('\n'),
      [child1Path]: '---\nstatus: done\ncompleted: 2026-08-14\n---\n',
      [child2Path]: [
        '---',
        `status: ${child2Status}`,
        ...(child2Terminal ? ['completed: 2026-08-14'] : []),
        '---',
      ].join('\n'),
    };
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, 'utf8');
    }
    return root;
  }

  it('accepts exact one-row projections for done and open children', async () => {
    const root = await agreementFixture();
    expect((await findTaskArchivalFindings(root)).findings).toEqual([]);
  });

  it.each([[[]], [['AGREEMENT-900']], [['CHILD-001', 'CHILD-001']]])(
    'rejects an invalid children declaration: %j',
    async (children) => {
      const root = await agreementFixture({ children });
      const reasons = (await findTaskArchivalFindings(root)).findings.map((item) => item.reason);
      expect(reasons.join('\n')).toMatch(/children|self|duplicate/i);
    },
  );

  it.each([
    [
      'checkbox',
      [
        childRow(false, 'CHILD-001', 'done', '.agents/tasks/completed/CHILD-001-done.md'),
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    ],
    [
      'status',
      [
        childRow(true, 'CHILD-001', 'in-progress', '.agents/tasks/completed/CHILD-001-done.md'),
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    ],
    [
      'path',
      [
        childRow(true, 'CHILD-001', 'done', '.agents/tasks/CHILD-001-done.md'),
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    ],
    [
      'missing row',
      [childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md')],
    ],
    [
      'prefix ID',
      [
        childRow(true, 'CHILD-001-P1', 'done', '.agents/tasks/completed/CHILD-001-done.md'),
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    ],
  ])('rejects a stale %s projection independently', async (_case, taskRows) => {
    const root = await agreementFixture({ taskRows });
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/CHILD-001/);
  });

  it.each(['missing', 'wrong-type'])(
    'cannot disable the relation by making the paired spec %s',
    async (mode) => {
      const root = await agreementFixture();
      const specPath = path.join(root, '.agents/spec-docs/active/AGREEMENT-900-parent.md');
      if (mode === 'missing') {
        await unlink(specPath);
      } else {
        const content = await readFile(specPath, 'utf8');
        writeFileSync(specPath, content.replace('type: AGREEMENT', 'type: RULE'));
      }
      const reasons = (await findTaskArchivalFindings(root)).findings
        .map((item) => item.reason)
        .join('\n');
      expect(reasons).toMatch(/paired spec|type: AGREEMENT/i);
    },
  );

  it('rejects a declared child that cannot be resolved', async () => {
    const root = await agreementFixture({ children: ['CHILD-001', 'CHILD-404'] });
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/CHILD-404.*exactly one Task/i);
  });

  it.each(['task', 'spec'])('rejects a duplicate %s pair record', async (kind) => {
    const root = await agreementFixture();
    const relative =
      kind === 'task'
        ? '.agents/tasks/AGREEMENT-900-duplicate.md'
        : '.agents/spec-docs/backlog/AGREEMENT-900-duplicate.md';
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      kind === 'task'
        ? '---\nstatus: in-progress\n---\n'
        : '---\nstatus: in-progress\ntype: AGREEMENT\ntags: [test]\n---\n',
    );
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/exactly one (?:paired )?(?:Task|spec)/i);
  });

  it('rejects a nested AGREEMENT child', async () => {
    const root = await agreementFixture();
    const nested = path.join(root, '.agents/spec-docs/active/CHILD-002-nested.md');
    writeFileSync(nested, '---\nstatus: in-progress\ntype: AGREEMENT\ntags: [test]\n---\n');
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/nested AGREEMENT child CHILD-002/i);
  });

  it('rejects a malformed projection row', async () => {
    const root = await agreementFixture({
      taskRows: [
        '- [x] CHILD-001 done `.agents/tasks/completed/CHILD-001-done.md`',
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    });
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/malformed ## Children row/i);
  });

  it('rejects stale spec-side projection independently', async () => {
    const root = await agreementFixture({
      specRows: [
        childRow(false, 'CHILD-001', 'done', '.agents/tasks/completed/CHILD-001-done.md'),
        childRow(false, 'CHILD-002', 'in-progress', '.agents/tasks/CHILD-002-open.md'),
      ],
    });
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/Tasks CHILD-001 row is stale/i);
  });

  it('rejects a child with a malformed terminal date', async () => {
    const root = await agreementFixture();
    const child = path.join(root, '.agents/tasks/completed/CHILD-001-done.md');
    writeFileSync(child, '---\nstatus: done\ncompleted: 2026-02-30\n---\n');
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/CHILD-001 has invalid lifecycle/i);
  });

  it('rejects parent projections left stale after child archival', async () => {
    const root = await agreementFixture();
    const source = path.join(root, '.agents/tasks/CHILD-002-open.md');
    const target = path.join(root, '.agents/tasks/completed/CHILD-002-open.md');
    writeFileSync(source, '---\nstatus: done\ncompleted: 2026-08-14\n---\n');
    await rename(source, target);
    const reasons = (await findTaskArchivalFindings(root)).findings
      .map((item) => item.reason)
      .join('\n');
    expect(reasons).toMatch(/CHILD-002 row is stale/i);
  });

  it.each(['in-progress', 'wontfix', 'skipped', 'superseded'])(
    'rejects successful parent done while a child is %s',
    async (child2Status) => {
      const root = await agreementFixture({
        parentStatus: 'done',
        parentCompleted: '2026-08-14',
        child2Status,
      });
      const reasons = (await findTaskArchivalFindings(root)).findings
        .map((item) => item.reason)
        .join('\n');
      expect(reasons).toMatch(/parent.*done|all.*done/i);
    },
  );

  it('validates archived AGREEMENT parents too', async () => {
    const root = await agreementFixture({
      archivedParent: true,
      parentStatus: 'done',
      parentCompleted: '2026-08-14',
      child2Status: 'done',
    });
    expect((await findTaskArchivalFindings(root)).findings).toEqual([]);
  });
});
