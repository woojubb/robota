/**
 * Issue #1965 — a task may not claim `done` while its own acceptance criteria sit unticked.
 *
 * The gap was found by PROBING, not by reading: four items were set to `status: done` with a
 * `completed:` date and moved to `completed/` — exactly what completing them would do — and
 * `unearned-done-claims`, `backlog-placement` and `task-archival` all PASSED. Nine unticked criteria
 * across three of them, including INFRA-097's "adversarial tests proving a PR cannot replace its own
 * required gate". The only failures came from inbound links breaking as the files moved.
 *
 * The first case below is that exact shape, and it is what every rule here is measured against.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

import {
  findUnmetCriteriaFindings,
  readExaminedArchiveCount,
  unmetCriteriaIn,
} from '../scan-done-with-unmet-criteria.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

const task = (body) => `---\nstatus: done\ncompleted: 2026-08-22\n---\n\n# A record\n\n${body}\n`;

describe('the case the existing scans passed', () => {
  it('reports an unticked criterion under a done record', () => {
    const unmet = unmetCriteriaIn(
      task('## Completion criteria\n\n- [x] TC-1: done.\n- [ ] TC-2: adversarial tests.'),
    );
    expect(unmet).toHaveLength(1);
    expect(unmet[0].text).toMatch(/TC-2/);
  });

  it.each([
    'Acceptance Criteria',
    'Acceptance',
    'Completion criteria',
    'Done gate',
    'Overall done gate',
    '수용 기준',
    '완료 기준',
    '검증 항목',
  ])('recognises `%s` as a claim heading', (heading) => {
    expect(unmetCriteriaIn(task(`## ${heading}\n\n- [ ] a criterion`))).toHaveLength(1);
  });
});

describe('what it deliberately does NOT report', () => {
  it('a Test Plan, which describes intended work rather than a completion claim', () => {
    // 174 of the 386 unticked boxes across `completed/` are here. Reporting them would make the
    // guard red on records that are legitimately complete, which is how a floor gets deleted rather
    // than fixed.
    expect(unmetCriteriaIn(task('## Test Plan\n\n- [ ] run the suite'))).toEqual([]);
  });

  it('a numbered phase heading from a migration plan', () => {
    expect(unmetCriteriaIn(task('## 2단계 — 레이아웃 / 내비게이션\n\n- [ ] a step'))).toEqual([]);
  });

  it('a criterion in a record that is NOT done', () => {
    const open = '---\nstatus: in-progress\n---\n\n## Completion criteria\n\n- [ ] TC-1\n';
    expect(unmetCriteriaIn(open)).toEqual([]);
  });

  it('a TICKED criterion', () => {
    expect(unmetCriteriaIn(task('## Completion criteria\n\n- [x] TC-1: done.'))).toEqual([]);
  });

  it('a checkbox inside a fenced block, which is pasted material', () => {
    // The same defect `unearned-done-claims` carried until INFRA-047 fixed it: a `#` or a `- [ ]`
    // inside a fence is quoted text, not the document speaking.
    const fenced = task('## Completion criteria\n\n- [x] TC-1.\n\n```md\n- [ ] an example\n```');
    expect(unmetCriteriaIn(fenced)).toEqual([]);
  });

  it('a heading that merely CONTAINS a claim word', () => {
    // `## Why the acceptance criteria changed` is prose about criteria, not a criteria list.
    expect(unmetCriteriaIn(task('## Why the acceptance criteria changed\n\n- [ ] a note'))).toEqual(
      [],
    );
  });
});

describe('this repository', () => {
  it('is at its frozen baseline', () => {
    const { findings } = findUnmetCriteriaFindings();
    const baseline = JSON.parse(
      readFileSync(
        path.join(WORKSPACE_ROOT, 'scripts/harness/done-criteria-baseline.json'),
        'utf8',
      ),
    );
    expect(findings.length).toBe(baseline.unmet);
  });

  it('reports an exact examined size against a fixture of KNOWN size', () => {
    // An exact value, not a bound: a lower bound is satisfied by every over-count. Three files in,
    // three examined — and the count is the POPULATION, so the clean file counts too.
    const root = mkdtempSync(path.join(tmpdir(), 'unmet-criteria-'));
    scratch.push(root);
    const dir = path.join(root, '.agents/tasks/completed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.md'), task('## Completion criteria\n\n- [ ] one'));
    writeFileSync(path.join(dir, 'b.md'), task('## Completion criteria\n\n- [ ] two\n- [ ] three'));
    writeFileSync(path.join(dir, 'c.md'), task('## Completion criteria\n\n- [x] met'));

    expect(readExaminedArchiveCount(root)).toBe(3);
    expect(findUnmetCriteriaFindings(root).findings).toHaveLength(3);
  });

  it('reports the SAME size after a second run, so the counter does not accumulate', () => {
    // The ORDER is the property: a counter that adds up across runs is indistinguishable from a
    // subject that is growing, unless the assertion is taken after the second run.
    const root = mkdtempSync(path.join(tmpdir(), 'unmet-criteria-'));
    scratch.push(root);
    const dir = path.join(root, '.agents/tasks/completed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.md'), task('## Completion criteria\n\n- [ ] one'));

    // The FINDER runs twice, and the assertion is taken after the second — calling only the reader
    // twice would not tell an accumulating counter from a growing subject, because the reader is
    // what resets it. `measurement-provenance` refused the first draft for exactly that.
    findUnmetCriteriaFindings(root);
    findUnmetCriteriaFindings(root);
    expect(readExaminedArchiveCount(root)).toBe(1);
  });
});
