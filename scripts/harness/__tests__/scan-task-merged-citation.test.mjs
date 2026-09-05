import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { SCAN_COMMANDS, advisoryScanNames } from '../run-all-scans.mjs';
import {
  citedUnitOf,
  citesWorkItem,
  completedPlanUnits,
  deliversOutsideRecords,
  examinedCommitCount,
  examinedRecordCount,
  findTaskMergedCitationFindings,
  openTaskRecords,
  workItemIdOf,
} from '../scan-task-merged-citation.mjs';

function workspace(records) {
  const root = makeTemp('task-merged-citation-');
  mkdirSync(path.join(root, '.agents/tasks/completed'), { recursive: true });
  for (const [name, spec] of Object.entries(records)) {
    const { status, body = '# record\n' } = typeof spec === 'string' ? { status: spec } : spec;
    writeFileSync(
      path.join(root, '.agents/tasks', name),
      `---\nid: ${workItemIdOf(path.basename(name)) ?? 'X-0'}\nstatus: ${status}\n---\n${body}`,
      'utf8',
    );
  }
  return root;
}

const delivered = { aaaaaaaaa1: ['packages/x/src/a.ts', '.agents/tasks/ARCH-100-x.md'] };
const filingOnly = { bbbbbbbbb2: ['.agents/tasks/ARCH-100-x.md', '.agents/spec-docs/x.md'] };
const changedPaths = (table) => (sha) => table[sha] ?? [];

describe('task-merged-citation (issue #2186)', () => {
  it('is registered in the aggregate harness as advisory under pr context', () => {
    expect(SCAN_COMMANDS.some((scan) => scan.name === 'task-merged-citation')).toBe(true);
    expect(advisoryScanNames()).toContain('task-merged-citation');
  });

  it('reads the work-item ID from a record name and cites it only as a whole token', () => {
    expect(workItemIdOf('ARCH-100-agent-gui.md')).toBe('ARCH-100');
    expect(workItemIdOf('HARNESS-DIET-003-scans.md')).toBe('HARNESS-DIET-003');
    expect(workItemIdOf('README.md')).toBe(null);
    expect(citesWorkItem('feat(gui): ARCH-100 thin layer (#2176)', 'ARCH-100')).toBe(true);
    expect(citesWorkItem('feat: ARCH-1000 something', 'ARCH-100')).toBe(false);
    expect(citesWorkItem('feat: HARNESS-ARCH-100', 'ARCH-100')).toBe(false);
    expect(deliversOutsideRecords(['.agents/tasks/a.md', 'packages/x/src/a.ts'])).toBe(true);
    expect(deliversOutsideRecords(['.agents/tasks/a.md', '.agents/spec-docs/a.md'])).toBe(false);
  });

  it('RED: an unfinished record cited by a delivering merged commit is exactly one finding naming it', () => {
    const root = workspace({ 'ARCH-100-x.md': 'in-progress', 'ARCH-101-y.md': 'todo' });
    const findings = findTaskMergedCitationFindings(root, {
      ref: 'develop',
      commits: [{ sha: 'aaaaaaaaa1', subject: 'feat(gui): ARCH-100 thin layer (#2176)' }],
      changedPaths: changedPaths(delivered),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.agents/tasks/ARCH-100-x.md');
    expect(findings[0].detail).toContain('aaaaaaaaa feat(gui): ARCH-100 thin layer');
    expect(findings[0].detail).toContain('reconcile the record');
    expect(examinedRecordCount()).toBe(2);
    expect(examinedCommitCount()).toBe(1);
  });

  it('removing either half — the citation, or the unfinished record — produces no finding', () => {
    const cited = {
      ref: 'develop',
      commits: [{ sha: 'aaaaaaaaa1', subject: 'feat: ARCH-100 done' }],
    };
    // No citation: the commit names a different item.
    expect(
      findTaskMergedCitationFindings(workspace({ 'ARCH-100-x.md': 'in-progress' }), {
        ...cited,
        commits: [{ sha: 'aaaaaaaaa1', subject: 'feat: ARCH-200 done' }],
        changedPaths: changedPaths(delivered),
      }),
    ).toEqual([]);
    // No unfinished record: the record is terminal.
    expect(
      findTaskMergedCitationFindings(workspace({ 'ARCH-100-x.md': 'done' }), {
        ...cited,
        changedPaths: changedPaths(delivered),
      }),
    ).toEqual([]);
    // A citation that delivers nothing outside the records tree (its own filing) is no finding.
    expect(
      findTaskMergedCitationFindings(workspace({ 'ARCH-100-x.md': 'in-progress' }), {
        ...cited,
        commits: [{ sha: 'bbbbbbbbb2', subject: 'docs(tasks): file ARCH-100' }],
        changedPaths: changedPaths(filingOnly),
      }),
    ).toEqual([]);
  });

  it('a frozen legacy record is a notice, not a finding, and a stale entry is reported removable', () => {
    const notices = [];
    const findings = findTaskMergedCitationFindings(workspace({ 'ARCH-100-x.md': 'in-progress' }), {
      ref: 'develop',
      commits: [{ sha: 'aaaaaaaaa1', subject: 'feat: ARCH-100 done' }],
      changedPaths: changedPaths(delivered),
      legacy: new Set(['ARCH-100', 'GONE-1']),
      notices,
    });
    expect(findings).toEqual([]);
    expect(notices.some((n) => /GONE-1 no longer fires/.test(n))).toBe(true);
    expect(notices.some((n) => /1 frozen record\(s\) still cited.*ARCH-100/.test(n))).toBe(true);
  });

  it('reads the unit token cited alongside an ID, and the units a record marks complete', () => {
    expect(citedUnitOf('feat(harness): arm the gate (STRUCT-012 S1)', 'STRUCT-012')).toBe('S1');
    expect(citedUnitOf('feat: STRUCT-012 done', 'STRUCT-012')).toBe(null);
    expect(completedPlanUnits('- [x] S1 — a\n- [ ] S2 — b\n')).toEqual(new Set(['S1']));
    expect(completedPlanUnits('# record\n')).toEqual(new Set());
  });

  it('a delivering commit citing an already-completed Plan unit does not reconcile as a finding', () => {
    const root = workspace({
      'STRUCT-012-x.md': {
        status: 'in-progress',
        body: '# record\n\n## Plan\n\n- [x] S1 — done\n- [ ] S2 — not done\n',
      },
    });
    const findings = findTaskMergedCitationFindings(root, {
      ref: 'develop',
      commits: [{ sha: 'aaaaaaaaa1', subject: 'feat(harness): arm the gate (STRUCT-012 S1)' }],
      changedPaths: () => ['packages/x/src/a.ts'],
    });
    expect(findings).toEqual([]);
  });

  it('a delivering commit citing a Plan unit still unchecked still reconciles as a finding', () => {
    const root = workspace({
      'STRUCT-012-x.md': {
        status: 'in-progress',
        body: '# record\n\n## Plan\n\n- [x] S1 — done\n- [ ] S2 — not done\n',
      },
    });
    const findings = findTaskMergedCitationFindings(root, {
      ref: 'develop',
      commits: [
        { sha: 'aaaaaaaaa1', subject: 'feat(harness): wire the next stage (STRUCT-012 S2)' },
      ],
      changedPaths: () => ['packages/x/src/a.ts'],
    });
    expect(findings).toHaveLength(1);
  });

  it('a delivering commit citing the bare ID with no unit suffix still reconciles as a finding', () => {
    const root = workspace({
      'STRUCT-012-x.md': {
        status: 'in-progress',
        body: '# record\n\n## Plan\n\n- [x] S1 — done\n',
      },
    });
    const findings = findTaskMergedCitationFindings(root, {
      ref: 'develop',
      commits: [{ sha: 'aaaaaaaaa1', subject: 'feat(harness): STRUCT-012 done' }],
      changedPaths: () => ['packages/x/src/a.ts'],
    });
    expect(findings).toHaveLength(1);
  });

  it('does not read archived records', () => {
    const root = workspace({});
    writeFileSync(
      path.join(root, '.agents/tasks/completed/ARCH-100-x.md'),
      '---\nstatus: in-progress\n---\n',
      'utf8',
    );
    expect(openTaskRecords(root)).toEqual([]);
  });
});
