import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

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
const { createWorkspaceProjectMutationBoundary } = await import('./project-relative-writer.js');

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

      createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity }).write(
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
        createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity }).delete(
          'state/entry.txt',
        ),
      ).toBe(true);

      expect(fs.readFileSync(join(outside, 'entry.txt'), 'utf8')).toBe('outside canary');
      expect(fs.existsSync(join(movedParent, 'entry.txt'))).toBe(false);
    },
  );

  it.runIf(process.platform === 'linux')(
    'uses one stable boundary for write, append, and delete operations',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-boundary-root-'));
      roots.push(root);
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      const boundary = createWorkspaceProjectMutationBoundary(identity, {
        resolve: () => identity,
      });

      expect(Object.isFrozen(boundary)).toBe(true);
      boundary.write('state/entry.txt', 'created');
      boundary.write('state/entry.txt', 'replaced');
      boundary.append('state/entry.txt', '-appended');
      expect(fs.readFileSync(join(root, 'state', 'entry.txt'), 'utf8')).toBe('replaced-appended');
      expect(boundary.delete('state/entry.txt')).toBe(true);
      expect(fs.existsSync(join(root, 'state', 'entry.txt'))).toBe(false);
    },
  );

  it.runIf(process.platform === 'linux')(
    'refuses a final target symlink without touching its outside target',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-target-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'robota-project-target-outside-'));
      roots.push(root, outside);
      fs.writeFileSync(join(outside, 'entry.txt'), 'outside canary');
      fs.symlinkSync(join(outside, 'entry.txt'), join(root, 'entry.txt'));
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });

      expect(() =>
        createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity }).write(
          'entry.txt',
          'must not escape',
        ),
      ).toThrowError(WorkspaceAuthorityRequiredError);
      expect(fs.readFileSync(join(outside, 'entry.txt'), 'utf8')).toBe('outside canary');
    },
  );

  it.runIf(process.platform === 'linux')(
    'refuses when the workspace identity changes during boundary setup',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-stale-root-'));
      const replacement = fs.mkdtempSync(join(tmpdir(), 'robota-project-stale-replacement-'));
      roots.push(root, replacement);
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      const replacementIdentity = Object.freeze({
        repositoryKey: `test:${replacement}`,
        displayPath: replacement,
        worktreeRoot: replacement,
      });
      let calls = 0;
      const boundary = createWorkspaceProjectMutationBoundary(identity, {
        resolve: () => (calls++ === 0 ? identity : replacementIdentity),
      });

      expect(() => boundary.write('entry.txt', 'must refuse')).toThrowError(
        /workspace identity changed/i,
      );
      expect(fs.existsSync(join(root, 'entry.txt'))).toBe(false);
      expect(fs.existsSync(join(replacement, 'entry.txt'))).toBe(false);
    },
  );

  it('fails closed on hosts without stable root-anchored mutation support', () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'robota-project-unsupported-root-'));
    roots.push(root);
    const identity = Object.freeze({
      repositoryKey: `test:${root}`,
      displayPath: root,
      worktreeRoot: root,
    });
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    try {
      const boundary = createWorkspaceProjectMutationBoundary(identity, {
        resolve: () => identity,
      });
      expect(() => boundary.write('entry.txt', 'must refuse')).toThrowError(
        /stable root-anchored host support/i,
      );
      expect(fs.existsSync(join(root, 'entry.txt'))).toBe(false);
    } finally {
      platform.mockRestore();
    }
  });
});
