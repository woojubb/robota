import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateUndocumentedExports,
  findPublicSurfaceFindings,
  loadUndocumentedExportBaseline,
  publicApiIdentifiers,
} from '../check-spec-public-surface.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-spec-surface-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

/** A minimal SPEC with a Public API Surface table listing the given exports. */
function spec(exports) {
  const rows = exports.map((name) => `| \`${name}\` | function | desc |`).join('\n');
  return [
    '# Fixture SPEC',
    '',
    '## Public API Surface',
    '',
    '| Export | Kind | Description |',
    '| ------ | ---- | ----------- |',
    rows,
    '',
  ].join('\n');
}

const EMPTY = { baseline: {} };

describe('check-spec-public-surface', () => {
  it('forward: flags a table identifier that appears nowhere in src (phantom regression)', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn', 'phantomThing']),
      'packages/foo/src/index.ts': 'export function documentedFn(): void {}\n',
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    const phantom = findings.filter((f) => f.type === 'spec-phantom-export');
    expect(phantom).toHaveLength(1);
    expect(phantom[0].detail).toContain('phantomThing');
  });

  it('reverse (RED): a new undocumented entry export FAILS when the package has no baseline allowance', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts':
        'export function documentedFn(): void {}\nexport function undocumentedFn(): void {}\n',
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    const reverse = findings.filter((f) => f.type === 'spec-undocumented-export');
    expect(reverse).toHaveLength(1);
    expect(reverse[0].detail).toContain('undocumentedFn');
    expect(reverse[0].detail).toContain('baseline of 0');
  });

  it('reverse (RED): a new undocumented export FAILS when it would RAISE a non-zero baseline count', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts': [
        'export function documentedFn(): void {}',
        'export function frozenDebtFn(): void {}',
        'export function brandNewUndocumentedFn(): void {}',
        '',
      ].join('\n'),
    });
    const findings = await findPublicSurfaceFindings(root, {
      baseline: { '@robota-sdk/foo': 1 },
    });
    const reverse = findings.filter((f) => f.type === 'spec-undocumented-export');
    expect(reverse).toHaveLength(1);
    expect(reverse[0].detail).toContain('2 undocumented');
    expect(reverse[0].detail).toContain('baseline of 1');
  });

  it('reverse: a package AT its frozen baseline count passes (debt frozen, not licensed to grow)', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts':
        'export function documentedFn(): void {}\nexport function frozenDebtFn(): void {}\n',
    });
    const findings = await findPublicSurfaceFindings(root, {
      baseline: { '@robota-sdk/foo': 1 },
    });
    expect(findings.filter((f) => f.type === 'spec-undocumented-export')).toHaveLength(0);
  });

  it('reverse: dropping below the baseline passes and emits a ratchet-tighten notice', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts': 'export function documentedFn(): void {}\n',
    });
    const notices = [];
    const findings = await findPublicSurfaceFindings(root, {
      baseline: { '@robota-sdk/foo': 3 },
      notices,
    });
    expect(findings).toHaveLength(0);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('@robota-sdk/foo');
    expect(notices[0]).toContain('tighten');
  });

  it('reverse: ignores type-only entry exports (export type / interface / export { type })', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/model.ts':
        'export interface Hidden {}\nexport type HiddenAlias = string;\n',
      'packages/foo/src/index.ts': [
        'export function documentedFn(): void {}',
        'export type Foo = string;',
        'export interface Bar {}',
        "export type { Hidden } from './model.js';",
        "export { type HiddenAlias } from './model.js';",
        '',
      ].join('\n'),
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    expect(findings.filter((f) => f.type === 'spec-undocumented-export')).toHaveLength(0);
  });

  it('reverse: enumerates symbols surfaced through an `export * from` barrel', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/surface.ts': 'export function surfacedFn(): void {}\n',
      'packages/foo/src/index.ts':
        "export function documentedFn(): void {}\nexport * from './surface.js';\n",
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    const reverse = findings.filter((f) => f.type === 'spec-undocumented-export');
    expect(reverse).toHaveLength(1);
    expect(reverse[0].detail).toContain('surfacedFn');
  });

  it('evaluateUndocumentedExports: a stale baseline entry (package fully documented) is tightenable', () => {
    const { findings, tightenable } = evaluateUndocumentedExports({}, { '@robota-sdk/gone': 5 });
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['@robota-sdk/gone']);
  });

  it('passes on the live repository with its frozen baseline (exit 0) and needs no tightening', async () => {
    const notices = [];
    expect(await findPublicSurfaceFindings(undefined, { notices })).toHaveLength(0);
    // A freshly regenerated baseline must be tight: no package sits below its frozen count.
    expect(notices).toEqual([]);
  });

  it('live baseline entries are all positive integers (a 0-count entry is dead weight)', () => {
    const baseline = loadUndocumentedExportBaseline();
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    for (const count of Object.values(baseline)) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
  });
});

describe('publicApiIdentifiers — hierarchical section extent (HARNESS-104)', () => {
  // The parser held ONE boolean across headings, so a `###` nested inside `## Public API Surface`
  // closed the section. Measured before the fix: 196 identifiers invisible across 7 packages, and
  // agent-command / agent-plugin / agent-transport / dag-framework read as having an empty table.
  const table = (...names) =>
    [
      '| Export | Kind | Description |',
      '| --- | --- | --- |',
      ...names.map((n) => `| \`${n}\` | function | d |`),
    ].join('\n');

  it('counts a table under a subheading nested inside the Public API section', () => {
    const spec = ['## Public API Surface', '', '### Core', '', table('alpha', 'beta')].join('\n');

    expect(publicApiIdentifiers(spec)).toEqual(['alpha', 'beta']);
  });

  it('still ENDS the section at the next same-level heading', () => {
    const spec = [
      '## Public API Surface',
      '',
      '### Core',
      '',
      table('inside'),
      '',
      '## Import Rules',
      '',
      table('outside'),
    ].join('\n');

    // Over-counting would replace a false negative with a false positive — the failure mode the
    // terminating half exists to prevent.
    expect(publicApiIdentifiers(spec)).toEqual(['inside']);
  });

  it('is level-relative rather than hard-coded to `##`', () => {
    const spec = [
      '## Reference',
      '',
      '### Public API',
      '',
      '#### Grouped',
      '',
      table('deep'),
      '',
      '### Other',
      '',
      table('sibling'),
    ].join('\n');

    expect(publicApiIdentifiers(spec)).toEqual(['deep']);
  });

  it('(CORE-035) a NESTED "Public API" subheading does not shrink the section', () => {
    // The defect HARNESS-104's fix left behind, one level down. `### … Public API …` re-assigned the
    // boundary from 2 to 3, so the very next sibling `###` closed the whole `##` section. Against
    // that, this returns only ['nested'] — everything after `### Schema` disappears.
    //
    // Measured on the real tree: `agent-core`'s SPEC has
    // `### Abort Classification Public API (CORE-027)` followed by `### Schema (CORE-015)`, and the
    // parser saw 69 of its 143 documented identifiers. Half the package's own Public API table read
    // as undocumented, including every table below Schema.
    const spec = [
      '## Public API Surface',
      '',
      table('top'),
      '',
      '### Abort Classification Public API',
      '',
      table('nested'),
      '',
      '### Schema',
      '',
      table('afterSibling'),
      '',
      '## Type Ownership',
      '',
      table('outside'),
    ].join('\n');

    expect(publicApiIdentifiers(spec)).toEqual(['top', 'nested', 'afterSibling']);
  });

  it('ignores tables that never enter the section at all', () => {
    const spec = ['## Type Ownership', '', table('notSurface')].join('\n');

    expect(publicApiIdentifiers(spec)).toEqual([]);
  });
});
