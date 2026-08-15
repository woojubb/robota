import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalTemporaryDirectory } from '../canonical-temporary-directory.mjs';

describe('canonicalTemporaryDirectory', () => {
  it('resolves aliases before sharing a temporary root with child processes', () => {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'harness-temp-root-'));
    const target = path.join(root, 'target');
    const alias = path.join(root, 'alias');
    try {
      symlinkSync(root, target, 'dir');
      symlinkSync(target, alias, 'dir');
      expect(canonicalTemporaryDirectory(alias)).toBe(realpathSync(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
