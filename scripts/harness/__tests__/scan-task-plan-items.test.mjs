import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  BASELINE_PATH,
  examinedPlanCount,
  findTaskPlanItemFindings,
  isDispositionItem,
} from '../scan-task-plan-items.mjs';

function fixture(files) {
  const root = makeTemp('robota-task-plan-items-');
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
  return root;
}

const task = (status, plan, extra = '') =>
  [
    '---',
    `status: ${status}`,
    ...(status === 'done' ? ['completed: 2026-08-25'] : []),
    '---',
    '',
    '# X-001',
    '',
    '## Plan',
    '',
    ...plan,
    '',
    '## Test Plan',
    '',
    '- [ ] `pnpm test` 0 failures',
    extra,
  ].join('\n');

describe('scan-task-plan-items (issue #2375)', () => {
  it('names the disposition verbs only when their object is the unit', () => {
    expect(isDispositionItem('Land and close issue #2215.')).toBe(true);
    expect(isDispositionItem('Merge this PR to develop')).toBe(true);
    expect(isDispositionItem('Publish the package to npm')).toBe(true);
    expect(isDispositionItem('Merge the two sorted arrays in the reducer')).toBe(false);
    expect(isDispositionItem('Close the file handle after the read')).toBe(false);
  });

  it('refuses an open Plan that names its own landing, and a done record with an unchecked Plan item', () => {
    const root = fixture({
      '.agents/tasks/X-001-open.md': task('todo', [
        '- [ ] Write the scan.',
        '- [ ] Land and close issue #2215.',
      ]),
      '.agents/tasks/completed/X-002-done.md': task('done', ['- [x] Done.', '- [ ] Roll out.']),
    });
    const findings = findTaskPlanItemFindings(root);
    expect(findings.map((f) => f.rule)).toEqual([
      'done-plan-item-unchecked',
      'plan-names-own-disposition',
    ]);
    expect(examinedPlanCount()).toBe(2);
  });

  it('reads the Plan SECTION only: an unchecked Test Plan row on a done record is not a finding', () => {
    const root = fixture({
      '.agents/tasks/completed/X-003-done.md': task('done', ['- [x] Everything.']),
    });
    expect(findTaskPlanItemFindings(root)).toEqual([]);
  });

  it('contains the pre-floor population by name and refuses an exemption nothing uses', () => {
    const baseline = (disposition, unchecked) =>
      JSON.stringify({ disposition, unchecked }, null, 2);
    const contained = fixture({
      '.agents/tasks/X-001-open.md': task('todo', ['- [ ] Land this Task on `develop`.']),
      '.agents/tasks/completed/X-002-done.md': task('done', ['- [ ] Roll out.']),
      [BASELINE_PATH]: baseline({ 'X-001-open.md': 'pre-floor' }, { 'X-002-done.md': 'pre-floor' }),
    });
    expect(findTaskPlanItemFindings(contained)).toEqual([]);

    const stale = fixture({
      '.agents/tasks/X-001-open.md': task('todo', ['- [ ] Write the scan.']),
      [BASELINE_PATH]: baseline({ 'X-001-open.md': 'pre-floor' }, {}),
    });
    expect(findTaskPlanItemFindings(stale).map((f) => f.rule)).toEqual([
      'baseline-exemption-unused',
    ]);
  });
});
