import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyTaskFile, findTaskArchivalFindings, main } from '../check-task-archival.mjs';
import { ADVISORY_MARKER } from '../run-all-scans.mjs';

describe('classifyTaskFile', () => {
  it('flags an all-checked breakdown whose spec is in spec-docs/done/', () => {
    const content = [
      '# PRESET-006: something',
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '## Plan',
      '- [x] TC-01',
      '- [x] TC-02',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.exemptReason).toBeNull();
    expect(result.reason).toContain('spec-docs/done/');
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

  it('flags via an explicit Status: completed line even without checkboxes', () => {
    const content = ['# Task', '- **Status**: completed', 'No checkboxes here.'].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.reason).toBe('Status: completed');
  });

  it('does not flag an in-progress status', () => {
    const content = ['- **Status**: in-progress', '- [x] TC-01'].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('treats an archival-exempt annotation as an exemption, not a finding', () => {
    const content = [
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
});

/**
 * HARNESS-063 — the scan says how much it examined.
 *
 * Measured on this repository 2026-08-01: `0` active task files and `422` archived ones, and
 * `task-archival scan passed.` was the entire output. The two halves are reported separately
 * because the archive is what made the pass look populated.
 */
describe('the examined count', () => {
  const ARCHIVABLE = ['Spec: `.agents/spec-docs/done/X-001.md`', '- [x] TC-01'].join('\n');
  const OPEN = ['Spec: `.agents/spec-docs/active/X-002.md`', '- [ ] TC-01'].join('\n');

  async function tasksFixture(files) {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-task-archival-'));
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
});
