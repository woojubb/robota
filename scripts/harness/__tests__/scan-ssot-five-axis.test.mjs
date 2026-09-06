import { describe, expect, it } from 'vitest';
import {
  checkPublicApiSurface,
  compareAffectedFiles,
  compareClosedSet,
  extractRootExports,
  findUndocumentedExports,
  requirePackageSpecs,
} from '../scan-ssot-five-axis.mjs';

describe('HARNESS-2253 five-axis SSOT checker', () => {
  it('derives named and grouped root exports', () => {
    expect(
      extractRootExports('export { A, type B as C } from "./x"; export function D() {}'),
    ).toEqual(['A', 'C', 'D']);
  });
  it('rejects a public row absent from the root export and accepts a NOTE disclamation', () => {
    const bad =
      '<!-- ssot:public-api-root -->\n## Public API Surface\n| Symbol | Meaning |\n| --- | --- |\n| `Ghost` | internal |\n';
    expect(checkPublicApiSurface(['Real'], bad)).toHaveLength(1);
    expect(checkPublicApiSurface([], `${bad}\nNOTE: Ghost is intentionally internal.`)).toEqual([]);
  });
  it('rejects an added export that is undocumented', () => {
    expect(
      findUndocumentedExports(['Visible', 'Missing'], '## Public API Surface\n| `Visible` | x |'),
    ).toEqual(['Added export Missing is not documented in the Public API section.']);
  });
  it('falsifies both directions of a closed-set mismatch', () => {
    expect(compareClosedSet(['A', 'Extra'], ['A', 'Missing'])).toEqual([
      'Closed set omits Missing.',
      'Closed set lists Extra, but the source union does not contain it.',
    ]);
    expect(compareClosedSet(['A'], ['A'])).toEqual([]);
  });
  it('falsifies both directions of an affected-file mismatch', () => {
    expect(compareAffectedFiles(['a.md', 'stale.md'], ['a.md', 'new.ts'])).toEqual([
      'Changed file new.ts is absent from Affected Files.',
      'Affected Files lists untouched file stale.md.',
    ]);
  });
  it('requires a package SPEC when production source changes', () => {
    expect(requirePackageSpecs(['packages/a/src/index.ts', 'packages/a/docs/SPEC.md'])).toEqual([]);
    expect(requirePackageSpecs(['packages/a/src/index.ts'])).toEqual([
      'Production package a changed without changing packages/a/docs/SPEC.md.',
    ]);
  });
});
