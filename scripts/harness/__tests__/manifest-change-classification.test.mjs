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

  it('limits developer-quality classification to harness scripts', () => {
    const before = { scripts: { build: 'pnpm build' } };
    const harnessOnly = {
      scripts: { ...before.scripts, 'harness:scan': 'node scripts/harness/run-all-scans.mjs' },
    };
    const productScript = { scripts: { ...before.scripts, build: 'pnpm build:all' } };

    expect(classifyRootManifestChange({ before, after: harnessOnly })).toMatchObject({
      kind: 'developer-quality-only',
      workspaceWide: false,
    });
    expect(classifyRootManifestChange({ before, after: productScript })).toMatchObject({
      kind: 'workspace-wide',
      workspaceWide: true,
    });
  });

  it('treats affected execution entry points as verification tooling, not product-wide changes', () => {
    const before = { scripts: { build: 'pnpm build', test: 'pnpm test' } };
    const after = {
      scripts: {
        ...before.scripts,
        'build:affected': 'node scripts/harness/workspace-affected-run.mjs --operation build',
        'test:affected': 'node scripts/harness/workspace-affected-run.mjs --operation test',
        'examples:typecheck:affected':
          'node scripts/harness/workspace-affected-run.mjs --operation examples-typecheck',
      },
    };

    expect(classifyRootManifestChange({ before, after })).toMatchObject({
      kind: 'developer-quality-only',
      workspaceWide: false,
    });
  });
});
