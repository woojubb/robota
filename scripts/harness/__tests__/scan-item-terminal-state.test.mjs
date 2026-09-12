import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTerminalStateFindings } from '../scan-item-terminal-state.mjs';
import { makeTemp } from './make-temp.mjs';

function fixture(status = 'in-progress', body = '') {
  const root = makeTemp('robota-terminal-state-');
  mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
  writeFileSync(
    path.join(root, '.agents/tasks/RULE-025-example.md'),
    `---\nstatus: ${status}\ncreated: 2020-01-01\n---\n${body}`,
  );
  return root;
}

describe('item-terminal-state', () => {
  it('recognizes a completed named delivery while other Plan work remains', () => {
    const root = fixture(
      'in-progress',
      '## Plan\n\n- [x] S1 — first unit\n- [ ] S2 — remaining unit\n',
    );
    expect(
      findTerminalStateFindings(root, {
        ageDays: () => 10,
        commits: [{ sha: 'abc', subject: 'feat: first unit (RULE-025 S1)' }],
        changedPaths: () => ['scripts/harness/example.mjs'],
        ref: 'origin/develop',
      }),
    ).toEqual([]);
  });

  it('finds aged in-progress tasks with a merged delivery citation', () => {
    const root = fixture();
    const findings = findTerminalStateFindings(root, {
      ageDays: () => 10,
      commits: [{ sha: 'abc', subject: 'feat: RULE-025 delivery' }],
      changedPaths: () => ['scripts/harness/example.mjs'],
      ref: 'origin/develop',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('item-terminal-state');
  });

  it.each([
    ['unqualified delivery', '- [x] S1 — first\n- [ ] S2 — second', 'feat: RULE-025 delivery'],
    ['unknown unit', '- [x] S1 — first\n- [ ] S2 — second', 'feat: unit (RULE-025 S9)'],
    ['unchecked unit', '- [ ] S1 — first\n- [ ] S2 — second', 'feat: unit (RULE-025 S1)'],
    ['finished Plan', '- [x] S1 — first\n- [x] S2 — second', 'feat: unit (RULE-025 S1)'],
    ['missing Plan items', '', 'feat: unit (RULE-025 S1)'],
    [
      'unchecked item outside Plan',
      '- [x] S1 — first\n\n## Notes\n- [ ] S2 — other',
      'feat: unit (RULE-025 S1)',
    ],
    [
      'checked unit outside Plan',
      '- [ ] S2 — second\n\n## Notes\n- [x] S1 — other',
      'feat: unit (RULE-025 S1)',
    ],
    ['unstructured checkbox', '- [x] first unit\n- [ ] second unit', 'feat: unit (RULE-025 S1)'],
  ])('still reports %s', (_name, plan, subject) => {
    const root = fixture('in-progress', `## Plan\n\n${plan}\n`);
    expect(
      findTerminalStateFindings(root, {
        ageDays: () => 10,
        commits: [{ sha: 'abc', subject }],
        changedPaths: () => ['scripts/harness/example.mjs'],
        ref: 'origin/develop',
      }),
    ).toHaveLength(1);
  });

  it('counts only unreconciled citations when named and whole-item deliveries coexist', () => {
    const root = fixture('in-progress', '## Plan\n- [x] S1 — first\n- [ ] S2 — second\n');
    const findings = findTerminalStateFindings(root, {
      ageDays: () => 10,
      commits: [
        { sha: 'abc', subject: 'feat: unit (RULE-025 S1)' },
        { sha: 'def', subject: 'feat: RULE-025 delivery' },
      ],
      changedPaths: () => ['scripts/harness/example.mjs'],
      ref: 'origin/develop',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('1 unreconciled merged delivery citation(s)');
  });

  it.each([
    ['young record', 6, 'feat: RULE-025 delivery', ['scripts/harness/example.mjs']],
    ['record-only commit', 10, 'docs: RULE-025 plan', ['.agents/tasks/RULE-025-example.md']],
    ['unrelated commit', 10, 'feat: RULE-0250 delivery', ['scripts/harness/example.mjs']],
  ])('preserves the %s exclusion', (_name, age, subject, changed) => {
    expect(
      findTerminalStateFindings(fixture(), {
        ageDays: () => age,
        commits: [{ sha: 'abc', subject }],
        changedPaths: () => changed,
        ref: 'origin/develop',
      }),
    ).toEqual([]);
  });

  it('keeps the seven-day age boundary inclusive', () => {
    expect(
      findTerminalStateFindings(fixture(), {
        ageDays: () => 7,
        commits: [{ sha: 'abc', subject: 'feat: RULE-025 delivery' }],
        changedPaths: () => ['scripts/harness/example.mjs'],
        ref: 'origin/develop',
      }),
    ).toHaveLength(1);
  });

  it('does not flag terminal tasks', () => {
    const root = fixture('done');
    expect(
      findTerminalStateFindings(root, {
        ageDays: () => 10,
        commits: [{ sha: 'abc', subject: 'feat: RULE-025 delivery' }],
        changedPaths: () => ['scripts/harness/example.mjs'],
        ref: 'origin/develop',
      }),
    ).toEqual([]);
  });
});
