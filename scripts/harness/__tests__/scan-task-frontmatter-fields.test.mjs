/**
 * INFRA-127 — the required-field floor must FAIL, and fail for the stated reason.
 *
 * The point of these rows is not that the scan runs. It is that each condition the floor claims to
 * refuse actually turns it red: a green scan whose red state nobody has seen is the same defect one
 * layer up, and this repository has caught that shape often enough to test for it directly.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedRecordCount,
  findTaskFrontmatterFindings,
  judgeRecord,
} from '../scan-task-frontmatter-fields.mjs';

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** A tree with `.agents/tasks/` and the given records. Cleaned up in `afterAll`. */
function treeWith(records) {
  const root = makeTemp('robota-task-frontmatter-');
  scratch.push(root);
  mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
  for (const [name, body] of Object.entries(records)) {
    writeFileSync(path.join(root, '.agents/tasks', name), body);
  }
  return root;
}

const COMPLETE = `---
title: 'X-001: a complete record'
status: todo
created: 2026-08-22
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# X-001
`;

describe('judgeRecord asks for exactly the seven declared fields', () => {
  it('passes a record carrying all of them', () => {
    expect(judgeRecord('X-001.md', COMPLETE)).toEqual([]);
  });

  for (const field of ['title', 'created', 'priority', 'urgency', 'area', 'depends_on']) {
    it(`reports a record missing \`${field}\``, () => {
      const text = COMPLETE.split('\n')
        .filter((l) => !l.startsWith(`${field}:`))
        .join('\n');
      const problems = judgeRecord('X-001.md', text);
      expect(problems.join(' ')).toContain(field);
    });
  }

  it('reports a PRESENT BUT BLANK value, which a key-presence check would pass', () => {
    // The failure this floor exists to stop is a record that looks complete to a grep. `area:` with
    // nothing after it satisfies "the key is there" and tells the next reader nothing.
    const problems = judgeRecord('X-001.md', COMPLETE.replace('area: scripts/harness', 'area:'));
    expect(problems.join(' ')).toContain('blank');
  });

  it('does NOT call an empty `depends_on: []` blank — it is a legitimate empty list', () => {
    expect(judgeRecord('X-001.md', COMPLETE)).toEqual([]);
  });

  it('reports a status outside the declared vocabulary', () => {
    const problems = judgeRecord('X-001.md', COMPLETE.replace('status: todo', 'status: nearly'));
    expect(problems.join(' ')).toContain('nearly');
  });

  it('accepts every status the README declares, open and terminal alike', () => {
    for (const s of [
      'todo',
      'in-progress',
      'blocked',
      'done',
      'wontfix',
      'skipped',
      'superseded',
    ]) {
      expect(judgeRecord('X-001.md', COMPLETE.replace('status: todo', `status: ${s}`))).toEqual([]);
    }
  });

  it('refuses a file with no readable frontmatter rather than skipping it', () => {
    // fail-direction: "I could not parse it" is not "it has the fields".
    expect(judgeRecord('X-001.md', '# no frontmatter here\n').join(' ')).toContain('frontmatter');
  });
});

describe('the sweep reads the active directory and honours the baseline', () => {
  it('finds an incomplete record', () => {
    const root = treeWith({
      'X-001.md': COMPLETE,
      'X-002.md': COMPLETE.replace('area: scripts/harness\n', ''),
    });
    const { findings, examined } = findTaskFrontmatterFindings(root);
    expect(examined).toBe(2);
    expect(findings.map((f) => f.name)).toEqual(['X-002.md']);
  });

  it('reports EVERY incomplete record, not just the first', () => {
    // A sweep that stops at the first finding turns a floor into a one-at-a-time queue, and the
    // second omission stays invisible until the first is fixed.
    const root = treeWith({
      'X-002.md': COMPLETE.replace('area: scripts/harness\n', ''),
      'X-003.md': COMPLETE.replace('urgency: soon\n', ''),
    });
    const { findings } = findTaskFrontmatterFindings(root);
    expect(findings.map((f) => f.name)).toEqual(['X-002.md', 'X-003.md']);
  });

  it('ignores README.md, which is prose and not a record', () => {
    const root = treeWith({ 'README.md': '# Tasks\n', 'X-001.md': COMPLETE });
    const { findings, examined } = findTaskFrontmatterFindings(root);
    expect(examined).toBe(1);
    expect(findings).toEqual([]);
  });
});

describe('the published size is readable, exact, and resets', () => {
  it('reports the exact number of records read, and the SAME number on a second sweep', () => {
    // measurement-provenance: the assertion is exact, not a lower bound, and it is repeated after a
    // second run over the same tree. A counter that accumulates passes the first assertion and fails
    // the second, which is the whole failure the reset rule exists for.
    const root = treeWith({ 'X-001.md': COMPLETE, 'X-002.md': COMPLETE, 'X-003.md': COMPLETE });
    findTaskFrontmatterFindings(root);
    expect(examinedRecordCount()).toBe(3);
    findTaskFrontmatterFindings(root);
    expect(examinedRecordCount()).toBe(3);
  });

  it('the reader tracks the subject, so a smaller tree reports a smaller number', () => {
    const big = treeWith({ 'X-001.md': COMPLETE, 'X-002.md': COMPLETE });
    const small = treeWith({ 'X-001.md': COMPLETE });
    findTaskFrontmatterFindings(big);
    expect(examinedRecordCount()).toBe(2);
    findTaskFrontmatterFindings(small);
    expect(examinedRecordCount()).toBe(1);
  });
});
