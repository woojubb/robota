import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  evaluateUndocumentedExports,
  findPublicSurfaceFindings,
  loadUndocumentedExportBaseline,
  publicApiIdentifiers,
} from '../check-spec-public-surface.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-spec-surface-');
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
const BASELINE_FILE = path.resolve(import.meta.dirname, '../spec-surface-baseline.json');

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

  it('forward (RED, issue #2228): a comment naming a deleted export is not evidence the export exists', async () => {
    // The measured instance: transport's index.ts carried
    //   `// HARNESS-103: \`createSessionCapabilityHost\` / \`readSessionCapability\` are NOT here.`
    // and both names were table rows. The old corpus concatenated raw source, so the sentence
    // written to say the symbols were gone passed both of them.
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn', 'movedAway']),
      'packages/foo/src/index.ts': [
        '// `movedAway` is NOT here. It moved to @robota-sdk/bar in ARCH-106.',
        '/* movedAway was also once mentioned in a block comment. */',
        'export function documentedFn(): void {}',
        '',
      ].join('\n'),
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    const phantom = findings.filter((f) => f.type === 'spec-phantom-export');
    expect(phantom).toHaveLength(1);
    expect(phantom[0].detail).toContain('movedAway');
  });

  it('forward (issue #2228): a type-only export and a `/testing` subpath export both resolve positively', async () => {
    // The corpus must cover EVERY declared entry, not only the root — transport publishes a
    // `./testing` subpath, and reading only `src/index.ts` would trade the wide-corpus defect for
    // the narrow one. Type exports are surface too, so they resolve without a text fallback.
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({
        name: '@robota-sdk/foo',
        exports: {
          '.': { source: './src/index.ts' },
          './testing': { source: './src/testing/index.ts' },
        },
      }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn', 'IShape', 'TAlias', 'makeFakeThing']),
      'packages/foo/src/shape.ts':
        'export interface IShape { x: number }\nexport type TAlias = string;\n',
      'packages/foo/src/index.ts':
        "export function documentedFn(): void {}\nexport type { IShape, TAlias } from './shape.js';\n",
      'packages/foo/src/testing/index.ts': 'export function makeFakeThing(): void {}\n',
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    expect(findings.filter((f) => f.type === 'spec-phantom-export')).toEqual([]);
  });

  it('forward: a table row that is a member, not an export, still passes when the CODE names it', async () => {
    // The live tables list session methods and slash commands beside exports; those are not
    // resolvable as exports and must not go red merely for being members. They pass on the code
    // corpus — but only the code, never a comment.
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['Session', 'getSessionId']),
      'packages/foo/src/index.ts':
        'export class Session {\n  getSessionId(): string {\n    return "s";\n  }\n}\n',
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    expect(findings.filter((f) => f.type === 'spec-phantom-export')).toEqual([]);
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
      baseline: { '@robota-sdk/foo': { runtime: 1 } },
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
      baseline: { '@robota-sdk/foo': { runtime: 1 } },
    });
    expect(findings.filter((f) => f.type === 'spec-undocumented-export')).toHaveLength(0);
  });

  it('reverse: dropping below the baseline passes and emits a ratchet-tighten notice naming the surface', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts': 'export function documentedFn(): void {}\n',
    });
    const notices = [];
    const findings = await findPublicSurfaceFindings(root, {
      baseline: { '@robota-sdk/foo': { runtime: 3 } },
      notices,
    });
    expect(findings).toHaveLength(0);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('@robota-sdk/foo (runtime)');
    expect(notices[0]).toContain('tighten');
  });

  // Issue #2331 — the type surface is ratcheted on its own, not skipped.
  it('reverse (RED): type-only entry exports (export type / interface / export { type }) count on the TYPE surface', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn', 'Bar']),
      'packages/foo/src/model.ts':
        'export interface Hidden {}\nexport type HiddenAlias = string;\nexport function surfaced(): void {}\n',
      'packages/foo/src/index.ts': [
        'export function documentedFn(): void {}',
        'export type Foo = string;',
        'export interface Bar {}',
        "export type { Hidden } from './model.js';",
        "export { type HiddenAlias } from './model.js';",
        "export type * from './model.js';",
        '',
      ].join('\n'),
    });
    const findings = await findPublicSurfaceFindings(root, EMPTY);
    expect(findings.filter((f) => f.type === 'spec-undocumented-export')).toHaveLength(0);
    const typeFindings = findings.filter((f) => f.type === 'spec-undocumented-type-export');
    expect(typeFindings).toHaveLength(1);
    // `Bar` is documented; `surfaced` reaches the entry only through `export type *`, so it is a type.
    expect(typeFindings[0].detail).toContain('4 undocumented type entry export(s)');
    expect(typeFindings[0].detail).toContain('`Foo`');
    expect(typeFindings[0].detail).toContain('`Hidden`');
    expect(typeFindings[0].detail).toContain('`HiddenAlias`');
    expect(typeFindings[0].detail).toContain('`surfaced`');
    expect(typeFindings[0].detail).not.toContain('`Bar`');
    expect(typeFindings[0].detail).toContain('type baseline of 0');
  });

  it('reverse: a runtime allowance never covers a type export, and a bare-number baseline is runtime-only', async () => {
    const root = await createFixture({
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts':
        'export function documentedFn(): void {}\nexport interface ICreateSessionResult {}\n',
    });
    const findings = await findPublicSurfaceFindings(root, {
      baseline: { '@robota-sdk/foo': { runtime: 5 } },
    });
    expect(findings.map((f) => f.type)).toEqual(['spec-undocumented-type-export']);
    expect(findings[0].detail).toContain('`ICreateSessionResult`');
    // The pre-#2331 shape reads as a runtime count only, so its type surface fails closed.
    expect(
      evaluateUndocumentedExports(
        { '@robota-sdk/foo': { specPath: 'x', runtime: [], type: ['ICreateSessionResult'] } },
        { '@robota-sdk/foo': { runtime: 5, type: 0 } },
      ).findings.map((f) => f.type),
    ).toEqual(['spec-undocumented-type-export']);
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

  it('evaluateUndocumentedExports: a stale baseline entry (package fully documented) is tightenable per surface', () => {
    const { findings, tightenable } = evaluateUndocumentedExports(
      {},
      { '@robota-sdk/gone': { runtime: 5, type: 2 }, '@robota-sdk/half': { runtime: 1, type: 0 } },
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual([
      '@robota-sdk/gone (runtime)',
      '@robota-sdk/gone (type)',
      '@robota-sdk/half (runtime)',
    ]);
  });

  it('loadUndocumentedExportBaseline: a bare-number entry is a runtime count with a type allowance of 0', async () => {
    const root = await createFixture({
      'legacy.json': JSON.stringify({ '@robota-sdk/old': 7, '@robota-sdk/new': { type: 2 } }),
    });
    expect(loadUndocumentedExportBaseline(path.join(root, 'legacy.json'))).toEqual({
      '@robota-sdk/old': { runtime: 7, type: 0 },
      '@robota-sdk/new': { runtime: 0, type: 2 },
    });
  });

  it('passes on the live repository with its frozen baseline (exit 0) and needs no tightening', async () => {
    const notices = [];
    expect(await findPublicSurfaceFindings(undefined, { notices })).toHaveLength(0);
    // A freshly regenerated baseline must be tight: no package sits below its frozen count.
    expect(notices).toEqual([]);
  });

  it('live baseline entries are per-surface positive integers (a 0-count surface is dead weight)', () => {
    const raw = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    expect(Object.keys(raw).length).toBeGreaterThan(0);
    for (const entry of Object.values(raw)) {
      expect(typeof entry).toBe('object');
      expect(Object.keys(entry).length).toBeGreaterThan(0);
      for (const [surface, count] of Object.entries(entry)) {
        expect(['runtime', 'type']).toContain(surface);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
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
