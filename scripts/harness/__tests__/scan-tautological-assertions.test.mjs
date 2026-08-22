import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findTautologicalAssertions,
  findTautologiesInSource,
  isInsideStringLiteral,
  isTestFile,
  TAUTOLOGY_RULES,
} from '../scan-tautological-assertions.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

async function fixture(files) {
  const root = makeTemp('robota-tautology-');
  for (const dir of ['packages', 'apps', 'scripts']) mkdirSync(path.join(root, dir));
  for (const [rel, content] of Object.entries(files)) {
    const absolute = path.join(root, rel);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

describe('tautological-assertion detection', () => {
  /**
   * The literal line from the former dag-framework worker-loop driver suite as it stood before
   * #1443. SEC-005 proved that suite inert by deleting the behaviour under test and watching it stay
   * green — this is the regression fixture for the incident that motivated the scan, so a rewrite
   * of the rules that stops catching it fails here.
   */
  it('flags the assertion from the dag-framework incident', () => {
    const findings = findTautologiesInSource('    expect(true).toBe(true);\n');
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('self-comparison');
  });

  it.each([
    ['expect(false).toBe(false);', 'self-comparison'],
    ["expect('x').toEqual('x');", 'self-comparison'],
    ['expect(42).toStrictEqual(42);', 'self-comparison'],
    ['expect(true).toBeTruthy();', 'literal-truthiness'],
    ['expect(false).toBeFalsy();', 'literal-truthiness'],
    ['expect(1).toBeDefined();', 'literal-defined'],
    ['assert.ok(true);', 'assert-literal'],
    ['expect(items.length).toBeGreaterThanOrEqual(0);', 'non-negative-length'],
  ])('flags %s', (line, rule) => {
    expect(findTautologiesInSource(line).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    'expect(result).toBe(true);',
    'expect(value).toEqual(expected);',
    "expect(name).toBe('robota');",
    'expect(list.indexOf(x)).toBeGreaterThanOrEqual(0);',
    'expect(items.length).toBeGreaterThanOrEqual(2);',
    'expect(plugin.dispose).toHaveBeenCalledTimes(1);',
  ])('does not flag the real assertion %s', (line) => {
    expect(findTautologiesInSource(line)).toEqual([]);
  });

  it('ignores a tautology quoted inside a comment', () => {
    expect(findTautologiesInSource('  // previously: expect(true).toBe(true);')).toEqual([]);
  });

  it('has no rule whose pattern matches an empty line', () => {
    for (const rule of TAUTOLOGY_RULES) expect(rule.pattern.test('')).toBe(false);
  });

  /**
   * A tautology QUOTED as data — the shape every fixture in this very file uses — must not be
   * flagged, or the guard becomes unusable in the files that document it.
   */
  it('ignores a tautology quoted as a string fixture', () => {
    expect(findTautologiesInSource("const bad = 'expect(true).toBe(true);';")).toEqual([]);
    expect(findTautologiesInSource('const bad = "expect(true).toBe(true);";')).toEqual([]);
  });

  it('still flags a real tautology on a line that also contains a closed string', () => {
    const findings = findTautologiesInSource("it('name', () => { expect(true).toBe(true); });");
    expect(findings).toHaveLength(1);
  });
});

describe('string-literal position', () => {
  it.each([
    ["const a = 'xx';", 11, true],
    ['const a = "xx";', 11, true],
    ["const a = 'xx'; b();", 18, false],
    ["const a = 'it\\'s'; b();", 21, false],
  ])('isInsideStringLiteral(%s, %i) === %s', (line, index, expected) => {
    expect(isInsideStringLiteral(line, index)).toBe(expected);
  });
});

describe('governed file selection', () => {
  it.each([
    'packages/a/src/x.test.ts',
    'packages/a/src/__tests__/x.ts',
    'apps/b/src/x.spec.tsx',
    'packages/c/src/__tests__/e2e/x.bintest.ts',
    'scripts/harness/__tests__/x.test.mjs',
  ])('governs %s', (rel) => expect(isTestFile(rel)).toBe(true));

  it.each(['packages/a/src/index.ts', 'packages/a/README.md', 'apps/b/src/testing/helper.ts'])(
    'does not govern %s',
    (rel) => expect(isTestFile(rel)).toBe(false),
  );
});

describe('tree traversal', () => {
  it('reports a tautology in a governed test file', async () => {
    const root = await fixture({
      'packages/a/src/thing.test.ts': 'it("x", () => {\n  expect(true).toBe(true);\n});\n',
    });
    const findings = findTautologicalAssertions(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });

  it('ignores the same line in production source', async () => {
    const root = await fixture({ 'packages/a/src/thing.ts': 'expect(true).toBe(true);\n' });
    expect(findTautologicalAssertions(root)).toEqual([]);
  });

  /**
   * The scan's own instance of the audited defect. Returning `[]` because `packages/` was not there
   * would be a test-assertion floor reporting a clean result over source it never opened.
   */
  it('THROWS rather than passing when a governed tree is absent', async () => {
    const root = makeTemp('robota-tautology-bare-');
    expect(() => findTautologicalAssertions(root)).toThrow(/governed tree\(s\) absent/);
  });

  it('is green on this repository', () => {
    expect(findTautologicalAssertions(WORKSPACE_ROOT)).toEqual([]);
  });
});
