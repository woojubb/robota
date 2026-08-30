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
});
