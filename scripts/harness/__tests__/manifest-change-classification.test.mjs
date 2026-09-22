import { describe, expect, it } from 'vitest';

import {
  changedManifestKeys,
  classifyRootManifestChange,
} from '../manifest-change-classification.mjs';

describe('manifest-change-classification', () => {
  it('compares nested manifest values independent of object key order', () => {
    expect(
      changedManifestKeys(
        { scripts: { build: 'a', test: 'b' } },
        { scripts: { test: 'b', build: 'a' } },
      ),
    ).toEqual([]);
  });

  it('limits developer-quality classification to explicit local authoring scripts', () => {
    const before = { scripts: { build: 'pnpm build' } };
    const localOnly = {
      scripts: { ...before.scripts, 'harness:review': 'node scripts/harness/review-change.mjs' },
    };
    const productScript = { scripts: { ...before.scripts, build: 'pnpm build:all' } };

    expect(classifyRootManifestChange({ before, after: localOnly })).toMatchObject({
      kind: 'developer-quality-only',
      workspaceWide: false,
    });
    expect(classifyRootManifestChange({ before, after: productScript })).toMatchObject({
      kind: 'workspace-wide',
      workspaceWide: true,
    });
  });

  it.each([
    'harness:workspace:run',
    'harness:scan:build-contracts',
    'harness:test:contracts:affected',
    'harness:verify:release',
    'build:affected',
    'test:affected',
    'examples:typecheck:affected',
  ])('fails closed for CI or product execution entrypoint %s', (script) => {
    const before = { scripts: { build: 'pnpm build', test: 'pnpm test' } };
    const after = { scripts: { ...before.scripts, [script]: 'changed command' } };

    expect(classifyRootManifestChange({ before, after })).toMatchObject({
      kind: 'workspace-wide',
      workspaceWide: true,
    });
  });
});
