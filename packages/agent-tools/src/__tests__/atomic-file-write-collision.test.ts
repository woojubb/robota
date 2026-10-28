import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: () => Buffer.alloc(16) };
});

import { atomicWriteUtf8File } from '../builtins/atomic-file-write';

it('does not overwrite or remove a pre-existing temporary file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atomic-collision-'));
  const target = join(directory, 'target.txt');
  const collision = join(directory, `.atomic-tmp-${'0'.repeat(32)}`);
  try {
    writeFileSync(collision, 'existing');
    await expect(atomicWriteUtf8File(target, 'replacement')).rejects.toThrow();
    expect(readFileSync(collision, 'utf8')).toBe('existing');
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
