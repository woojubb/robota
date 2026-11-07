import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { selectedFolderWithinTrustRoot } from '../desktop-trust-root.js';

it('accepts a selected Git subfolder only under the root named by its native decision', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-trust-root-')));
  try {
    const root = join(parent, 'repo');
    const nested = join(root, 'nested');
    const sibling = join(parent, 'other');
    mkdirSync(nested, { recursive: true });
    mkdirSync(sibling);
    expect(selectedFolderWithinTrustRoot(nested, root)).toBe(true);
    expect(selectedFolderWithinTrustRoot(root, root)).toBe(true);
    expect(selectedFolderWithinTrustRoot(sibling, root)).toBe(false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
