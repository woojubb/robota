import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({
  run: undefined as (() => void) | undefined,
}));

vi.mock('@robota-sdk/agent-file-authority', async () => {
  const actual = await import('@robota-sdk/agent-file-authority/testing');
  return {
    createStableRootedFileWriter: (root: string) =>
      actual.createStableRootedFileWriterForTest(root, {
        afterDirectoryOpened: (index) => {
          if (index !== 0) return;
          const run = swap.run;
          swap.run = undefined;
          run?.();
        },
      }),
  };
});

import { createWriteTool } from '../write-tool.js';

describe.runIf(process.platform !== 'win32')('Write containment under a directory swap', () => {
  let base = '';
  afterEach(() => {
    swap.run = undefined;
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it('does not replace an outside file when an admitted parent becomes a symlink', async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'write-containment-')));
    const root = join(base, 'root');
    const parent = join(root, 'parent');
    const outside = join(base, 'outside');
    mkdirSync(parent, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(parent, 'note.txt'), 'inside');
    writeFileSync(join(outside, 'note.txt'), 'outside');
    swap.run = () => {
      renameSync(parent, join(base, 'moved'));
      symlinkSync(outside, parent);
    };

    const result = await createWriteTool({ cwd: root }).execute({
      filePath: join(parent, 'note.txt'),
      content: 'replacement',
    });

    expect(swap.run).toBeUndefined();
    expect(result.success).toBe(false);
    expect(JSON.parse(String(result.data))).toMatchObject({ success: false });
    expect(readFileSync(join(outside, 'note.txt'), 'utf8')).toBe('outside');
    expect(readFileSync(join(base, 'moved', 'note.txt'), 'utf8')).toBe('inside');
  });
});
