import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findPublicSurfaceFindings } from '../check-spec-public-surface.mjs';

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

const EMPTY = { allowlist: new Set() };

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

  it('reverse: flags an entry runtime export missing from the Public API table', async () => {
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

  it('reverse: an allowlisted undocumented export is exempt', async () => {
    const files = {
      'packages/foo/package.json': JSON.stringify({ name: '@robota-sdk/foo' }),
      'packages/foo/docs/SPEC.md': spec(['documentedFn']),
      'packages/foo/src/index.ts':
        'export function documentedFn(): void {}\nexport function undocumentedFn(): void {}\n',
    };
    const root = await createFixture(files);
    const allowlist = new Set(['@robota-sdk/foo#undocumentedFn']);
    const findings = await findPublicSurfaceFindings(root, { allowlist });
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

  it('passes on the live repository with its frozen baseline (exit 0)', async () => {
    expect(await findPublicSurfaceFindings()).toHaveLength(0);
  });
});
