/**
 * INFRA-127 — the column-shape floor must go RED on the shape it exists for.
 *
 * The subject file is green today, because the six rows that motivated this floor were fixed before
 * it was written. A floor whose red state has never been observed is exactly the defect this
 * repository keeps finding one layer up, so the rows below drive the failure directly instead of
 * relying on the tree to supply one.
 */

import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

import {
  examinedCatalogueCount,
  examinedRowCount,
  findRuleTableShapeFindings,
  findShapeFindings,
  splitRow,
} from '../scan-rule-table-shape.mjs';

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** A tree carrying one catalogue at the given relative path. */
function treeWithCatalogue(relative, text) {
  const root = mkdtempSync(path.join(tmpdir(), 'robota-rule-table-shape-'));
  scratch.push(root);
  mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
  return root;
}

const HEADER = '| # | Mistake | Correct approach |';
const RULE = '| --- | --- | --- |';

describe('splitRow honours an escaped pipe', () => {
  it('counts three cells in an ordinary row', () => {
    expect(splitRow('| 1 | a | b |')).toHaveLength(3);
  });

  it('does NOT split on `\\|`, which rule text uses to quote a shell pipeline', () => {
    // The naive split reports this correct row as over-full. `cmd \| tail -n` is real text in
    // common-mistakes 92, so getting this wrong would make the floor fire on the entry that
    // describes the very failure it was written beside.
    expect(splitRow('| 1 | `cmd \\| tail -n` | judge it directly |')).toHaveLength(3);
  });

  it('is not confused by a row without outer pipes', () => {
    expect(splitRow('1 | a | b')).toHaveLength(3);
  });
});

describe('findShapeFindings judges each row against its own table header', () => {
  const table = (...rows) => [HEADER, RULE, ...rows].join('\n');

  it('passes rows that fill the declared columns', () => {
    expect(findShapeFindings(table('| 1 | a | b |', '| 2 | c | d |'), 'f.md')).toEqual([]);
  });

  it('reports a SHORT row — the case that renders with an empty column', () => {
    const findings = findShapeFindings(table('| 1 | everything in one cell |'), 'f.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ got: 2, want: 3 });
  });

  it('reports a LONG row — markdown drops the surplus, so the text is on disk and not on the page', () => {
    const findings = findShapeFindings(table('| 1 | a | b | c |'), 'f.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ got: 4, want: 3 });
  });

  it('does not judge a second table against the first table header', () => {
    // A file with two tables of different widths is ordinary. Carrying the first header into the
    // second would report correct rows, which is how a floor earns a suppression instead of a fix.
    const text = [
      table('| 1 | a | b |'),
      '',
      'Prose between them.',
      '',
      ['| k | v |', '| --- | --- |', '| x | y |'].join('\n'),
    ].join('\n');
    expect(findShapeFindings(text, 'f.md')).toEqual([]);
  });

  it('does not treat the delimiter row as a finding', () => {
    expect(findShapeFindings(table('| 1 | a | b |'), 'f.md')).toEqual([]);
  });

  it('reports the header line, so the reader can see what the row is judged against', () => {
    const findings = findShapeFindings(table('| 1 | short |'), 'f.md');
    expect(findings[0].headerLine).toBe(1);
  });
});

describe('the published sizes are readable, exact, and reset', () => {
  const CAT = '.agents/rules/common-mistakes.md';
  const text = ['| # | Mistake | Correct approach |', '| --- | --- | --- |', '| 1 | a | b |'].join(
    '\n',
  );

  it('reports exact counts, and the SAME counts on a second sweep', () => {
    // measurement-provenance: exact, and asserted again after a second run so an accumulating
    // counter is told apart from a growing subject.
    const root = treeWithCatalogue(CAT, text);
    findRuleTableShapeFindings(root, [CAT]);
    expect(examinedRowCount()).toBe(3);
    expect(examinedCatalogueCount()).toBe(1);
    findRuleTableShapeFindings(root, [CAT]);
    expect(examinedRowCount()).toBe(3);
    expect(examinedCatalogueCount()).toBe(1);
  });

  it('reports a MISSING catalogue rather than counting zero rows quietly', () => {
    // fail-direction: the subject vanishing must be loud. A silent zero here would read as
    // "every row fills its columns" over a file that is not there.
    const root = treeWithCatalogue('.agents/rules/other.md', text);
    const { findings } = findRuleTableShapeFindings(root, [CAT]);
    expect(findings).toHaveLength(1);
    expect(findings[0].missing).toBe(true);
  });
});
