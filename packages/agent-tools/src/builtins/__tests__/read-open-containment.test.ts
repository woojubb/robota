import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadTool } from '../read-tool.js';

/**
 * Run `swap.run` just BEFORE the tool opens `swap.path` — after the containment check has passed, the
 * moment a check that is separate from the open is exposed (issue #3252).
 */
const swap = vi.hoisted(() => ({
  path: undefined as string | undefined,
  run: undefined as (() => void) | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    if (swap.path !== undefined && args[0] === swap.path) {
      const run = swap.run;
      swap.path = undefined;
      swap.run = undefined;
      run?.();
    }
    return actual.open(...args);
  }) as typeof actual.open;
  return { ...actual, open };
});

async function read(
  root: string,
  filePath: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const outcome = await createReadTool({ cwd: root }).execute({ filePath });
  return JSON.parse(String((outcome as { data?: unknown }).data)) as {
    success: boolean;
    output: string;
    error?: string;
  };
}

describe('Read decides containment on the file it opened', () => {
  let base: string;
  let root: string;
  let outsideDir: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'read-open-containment-')));
    root = join(base, 'root');
    outsideDir = join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outsideDir);
    writeFileSync(join(outsideDir, 'notes.txt'), 'OUTSIDE-SECRET');
  });
  afterEach(() => {
    swap.path = undefined;
    swap.run = undefined;
    rmSync(base, { recursive: true, force: true });
  });

  it('refuses a file swapped for a link to outside the root after the check', async () => {
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'inside');
    swap.path = file;
    swap.run = () => {
      rmSync(file);
      symlinkSync(join(outsideDir, 'notes.txt'), file);
    };

    const result = await read(root, file);
    expect(swap.path).toBeUndefined();
    expect(result.output).not.toContain('OUTSIDE-SECRET');
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Access denied/) });
  });

  it('refuses a directory on the path swapped for a link to outside the root after the check', async () => {
    const dir = join(root, 'dir');
    mkdirSync(dir);
    const file = join(dir, 'notes.txt');
    writeFileSync(file, 'inside');
    swap.path = file;
    swap.run = () => {
      renameSync(dir, join(base, 'moved-away'));
      symlinkSync(outsideDir, dir);
    };

    const result = await read(root, file);
    expect(swap.path).toBeUndefined();
    expect(result.output).not.toContain('OUTSIDE-SECRET');
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Access denied/) });
  });

  it('still reads through a link that stays inside the root, and a root reached through a link', async () => {
    writeFileSync(join(root, 'real.txt'), 'linked content');
    symlinkSync(join(root, 'real.txt'), join(root, 'alias.txt'));
    const rootAlias = join(base, 'root-alias');
    symlinkSync(root, rootAlias);

    const viaLink = await read(root, join(root, 'alias.txt'));
    expect(viaLink).toMatchObject({ success: true });
    expect(viaLink.output).toContain('linked content');

    const viaRootAlias = await read(rootAlias, join(rootAlias, 'alias.txt'));
    expect(viaRootAlias).toMatchObject({ success: true });
    expect(viaRootAlias.output).toContain('linked content');
  });

  it('reads under a root spelled in another letter case, where the filesystem ignores case', async (ctx) => {
    const cased = join(base, 'CaseRoot');
    mkdirSync(cased);
    const typed = join(base, 'caseroot');
    if (!existsSync(typed)) ctx.skip();
    writeFileSync(join(cased, 'notes.txt'), 'cased content');

    const result = await read(typed, join(typed, 'notes.txt'));
    expect(result).toMatchObject({ success: true });
    expect(result.output).toContain('cased content');
  });
});
