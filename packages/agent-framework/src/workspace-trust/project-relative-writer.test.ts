import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({
  armedParent: undefined as string | undefined,
  movedParent: undefined as string | undefined,
  outside: undefined as string | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const triggerSwap = (path: string): void => {
    const resolved = path.startsWith('/proc/self/fd/') ? actual.realpathSync(path) : path;
    if (
      resolved === swap.armedParent &&
      swap.movedParent !== undefined &&
      swap.outside !== undefined
    ) {
      const movedParent = swap.movedParent;
      const outside = swap.outside;
      swap.armedParent = undefined;
      actual.renameSync(resolved, movedParent);
      actual.symlinkSync(outside, resolved, 'dir');
    }
  };
  return {
    ...actual,
    fstatSync(descriptor: number, options?: unknown) {
      const metadata = actual.fstatSync(descriptor, options as never);
      triggerSwap(`/proc/self/fd/${descriptor}`);
      return metadata;
    },
    lstatSync(path: Parameters<typeof actual.lstatSync>[0], options?: unknown) {
      const metadata = actual.lstatSync(path, options as never);
      if (typeof path === 'string') triggerSwap(path);
      return metadata;
    },
  };
});

const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
const { deleteWorkspaceRelativeFile, writeWorkspaceRelativeFile } =
  await import('./project-relative-writer.js');

describe('project-relative writer containment', () => {
  const roots: string[] = [];

  afterEach(() => {
    swap.armedParent = undefined;
    swap.movedParent = undefined;
    swap.outside = undefined;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'linux')(
    'does not redirect a write when a verified parent is replaced with an outside link',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-write-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'robota-project-write-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const movedParent = join(root, 'state-original');
      fs.mkdirSync(parent);
      fs.writeFileSync(join(outside, 'entry.txt'), 'outside canary');
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      swap.armedParent = parent;
      swap.movedParent = movedParent;
      swap.outside = outside;

      writeWorkspaceRelativeFile(
        identity,
        { resolve: () => identity },
        'state/entry.txt',
        'inside',
      );

      expect(fs.readFileSync(join(outside, 'entry.txt'), 'utf8')).toBe('outside canary');
      expect(fs.readFileSync(join(movedParent, 'entry.txt'), 'utf8')).toBe('inside');
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not redirect a delete when a verified parent is replaced with an outside link',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-delete-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'robota-project-delete-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const movedParent = join(root, 'state-original');
      fs.mkdirSync(parent);
      fs.writeFileSync(join(parent, 'entry.txt'), 'inside canary');
      fs.writeFileSync(join(outside, 'entry.txt'), 'outside canary');
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      swap.armedParent = parent;
      swap.movedParent = movedParent;
      swap.outside = outside;

      expect(
        deleteWorkspaceRelativeFile(identity, { resolve: () => identity }, 'state/entry.txt'),
      ).toBe(true);

      expect(fs.readFileSync(join(outside, 'entry.txt'), 'utf8')).toBe('outside canary');
      expect(fs.existsSync(join(movedParent, 'entry.txt'))).toBe(false);
    },
  );
});
