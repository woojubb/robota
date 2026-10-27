import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({
  file: undefined as string | undefined,
  run: undefined as (() => void) | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const createReadStream = ((...args: Parameters<typeof actual.createReadStream>) => {
    if (args[0] === swap.file) {
      const run = swap.run;
      swap.file = undefined;
      swap.run = undefined;
      run?.();
    }
    return actual.createReadStream(...args);
  }) as typeof actual.createReadStream;
  return { ...actual, createReadStream };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    if (args[0] === swap.file) {
      const run = swap.run;
      swap.file = undefined;
      swap.run = undefined;
      run?.();
    }
    return actual.open(...args);
  }) as typeof actual.open;
  return { ...actual, open };
});

import { createEditTool } from '../edit-tool.js';

describe.runIf(process.platform === 'linux' || process.platform === 'darwin')('Edit read containment', () => {
  let base = '';
  afterEach(() => {
    swap.file = undefined;
    swap.run = undefined;
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it('does not read and edit an outside file after a checked directory is swapped', async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'edit-containment-')));
    const root = join(base, 'root');
    const parent = join(root, 'parent');
    const outside = join(base, 'outside');
    mkdirSync(parent, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(parent, 'note.txt'), 'inside');
    writeFileSync(join(outside, 'note.txt'), 'outside needle');
    const file = join(parent, 'note.txt');
    swap.file = file;
    swap.run = () => {
      renameSync(parent, join(base, 'moved'));
      symlinkSync(outside, parent);
    };

    const result = await createEditTool({ cwd: root }).execute({ filePath: file, oldString: 'needle', newString: 'changed' });

    expect(swap.file).toBeUndefined();
    expect(JSON.parse(String(result.data))).toMatchObject({ success: false, error: expect.stringMatching(/Access denied/) });
    expect(readFileSync(join(outside, 'note.txt'), 'utf8')).toBe('outside needle');
  });

  it('allows an ordinary edit when the selected containment root is the filesystem root', async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'edit-root-')));
    const file = join(base, 'note.txt');
    writeFileSync(file, 'old');
    const result = await createEditTool({ cwd: '/' }).execute({ filePath: file, oldString: 'old', newString: 'new' });
    expect(JSON.parse(String(result.data))).toMatchObject({ success: true });
    expect(readFileSync(file, 'utf8')).toBe('new');
  });
});
