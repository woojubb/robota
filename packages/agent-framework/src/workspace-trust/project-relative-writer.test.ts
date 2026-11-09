import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

const swap = vi.hoisted(() => ({
  armedParent: undefined as string | undefined,
  movedParent: undefined as string | undefined,
  outside: undefined as string | undefined,
  // `fsync:<path>` and `rename:<source path>` in call order, each descriptor resolved to its path.
  calls: [] as string[],
  // A path suffix whose unlink fails, and the errno code a directory fsync fails with.
  failUnlinkSuffix: undefined as string | undefined,
  failDirectoryFsync: undefined as string | undefined,
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
    fsyncSync(descriptor: number) {
      swap.calls.push(`fsync:${actual.realpathSync(`/proc/self/fd/${descriptor}`)}`);
      if (swap.failDirectoryFsync !== undefined && actual.fstatSync(descriptor).isDirectory()) {
        throw Object.assign(new Error('fsync failed'), { code: swap.failDirectoryFsync });
      }
      actual.fsyncSync(descriptor);
    },
    renameSync(from: string, to: string) {
      swap.calls.push(`rename:${actual.realpathSync(from)}`);
      actual.renameSync(from, to);
    },
    unlinkSync(path: string) {
      if (swap.failUnlinkSuffix !== undefined && path.endsWith(swap.failUnlinkSuffix)) {
        throw Object.assign(new Error('unlink failed'), { code: 'EPERM' });
      }
      actual.unlinkSync(path);
    },
  };
});

const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
const { createWorkspaceProjectMutationBoundary, supportsWorkspaceProjectMutation } =
  await import('./project-relative-writer.js');

function boundaryFor(root: string): ReturnType<typeof createWorkspaceProjectMutationBoundary> {
  const identity = Object.freeze({
    repositoryKey: `test:${root}`,
    displayPath: root,
    worktreeRoot: root,
  });
  return createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity });
}

const STALE_TEMPORARY = '.entry.json.0123456789abcdef.tmp';

/**
 * Fills `directory` with temp-file lookalikes for `entry.json`. Everything except `STALE_TEMPORARY`
 * is old enough to be swept were it a real leftover, so only the name, type or age protects it.
 */
function seedTemporaries(directory: string, linkTarget: string): string[] {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const write = (name: string, age?: Date): void => {
    fs.writeFileSync(join(directory, name), name);
    if (age !== undefined) fs.utimesSync(join(directory, name), age, age);
  };
  fs.mkdirSync(directory, { recursive: true });
  write(STALE_TEMPORARY, anHourAgo);
  const kept = [
    '.entry.json.fedcba9876543210.tmp', // fresh: a writer may still be about to rename it
    '.entry.json.0123456789abcdef.tmp.bak',
    '.entry.json.0123456789abcde.tmp',
    '.entry.json.0123456789ABCDEF.tmp',
    '.entryxjson.0123456789abcdef.tmp', // `.` in the file name is not a wildcard
    '.other.json.0123456789abcdef.tmp',
    'entry.json.0123456789abcdef.tmp',
  ];
  kept.forEach((name, index) => write(name, index === 0 ? undefined : anHourAgo));
  const linkName = '.entry.json.aaaaaaaaaaaaaaaa.tmp';
  fs.symlinkSync(linkTarget, join(directory, linkName));
  fs.lutimesSync(join(directory, linkName), anHourAgo, anHourAgo);
  const directoryName = '.entry.json.bbbbbbbbbbbbbbbb.tmp';
  fs.mkdirSync(join(directory, directoryName));
  fs.writeFileSync(join(directory, directoryName, 'inner'), 'inner');
  fs.utimesSync(join(directory, directoryName), anHourAgo, anHourAgo);
  return [...kept, linkName, directoryName];
}

describe('project-relative writer containment', () => {
  const roots: string[] = [];

  afterEach(() => {
    swap.armedParent = undefined;
    swap.movedParent = undefined;
    swap.outside = undefined;
    swap.calls.length = 0;
    swap.failUnlinkSuffix = undefined;
    swap.failDirectoryFsync = undefined;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'linux')(
    'claims one plain directory without following a substituted parent or target',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-claim-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-claim-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const moved = join(root, 'state-original');
      fs.mkdirSync(parent);
      const boundary = boundaryFor(root);
      if (boundary.claimDirectory === undefined) throw new Error('atomic claim missing');
      swap.armedParent = parent;
      swap.movedParent = moved;
      swap.outside = outside;
      expect(boundary.claimDirectory('state/turn-0001')).toBe(true);
      expect(fs.existsSync(join(moved, 'turn-0001'))).toBe(true);
      expect(fs.readdirSync(outside)).toEqual([]);

      fs.unlinkSync(parent);
      fs.renameSync(moved, parent);
      expect(boundary.claimDirectory('state/turn-0001')).toBe(false);
      fs.symlinkSync(outside, join(parent, 'turn-0002'));
      expect(() => boundary.claimDirectory?.('state/turn-0002')).toThrow();
      fs.writeFileSync(join(parent, 'turn-0003'), 'existing');
      expect(() => boundary.claimDirectory?.('state/turn-0003')).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    },
  );

  it.runIf(process.platform === 'linux')(
    'closes its retained marker directory after refusal and release',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-marker-fds-'));
      roots.push(root);
      const boundary = boundaryFor(root);
      if (!boundary.acquireWriter)
        throw new Error('project host must expose an anchored writer lease');
      const directory = join(root, 'state', '.writer');
      const descriptors = (): number =>
        fs.readdirSync('/proc/self/fd').filter((name) => {
          try {
            return fs.readlinkSync(`/proc/self/fd/${name}`) === directory;
          } catch {
            return false;
          }
        }).length;
      const before = descriptors();
      const lease = boundary.acquireWriter('state/.writer');
      expect(lease?.holds()).toBe(true);
      expect(descriptors()).toBe(before + 1);
      expect(boundary.acquireWriter('state/.writer')).toBeUndefined();
      expect(descriptors()).toBe(before + 1);
      lease?.release();
      lease?.release();
      expect(descriptors()).toBe(before);
    },
  );

  it.runIf(process.platform === 'linux')(
    'anchors writer-marker operations when a parent is swapped',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-marker-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-marker-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const moved = join(root, 'state-original');
      fs.mkdirSync(parent);
      fs.mkdirSync(join(outside, '.writer'));
      fs.chmodSync(join(outside, '.writer'), 0o755);
      const boundary = boundaryFor(root);
      expect(boundary.acquireWriter).toBeDefined();
      if (!boundary.acquireWriter)
        throw new Error('project host must expose an anchored writer lease');
      swap.armedParent = parent;
      swap.movedParent = moved;
      swap.outside = outside;
      expect(() => boundary.acquireWriter?.('state/.writer')).toThrow();
      expect(swap.armedParent).toBeUndefined();
      expect(fs.statSync(join(outside, '.writer')).mode & 0o777).toBe(0o755);
      expect(fs.readdirSync(join(outside, '.writer'))).toEqual([]);
    },
  );

  it.runIf(process.platform === 'linux')(
    'loses a writer lease when its directory is renamed and never releases into a replacement',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-marker-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-marker-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const moved = join(root, 'state-original');
      fs.mkdirSync(parent);
      const boundary = boundaryFor(root);
      if (!boundary.acquireWriter)
        throw new Error('project host must expose an anchored writer lease');
      const lease = boundary.acquireWriter('state/.writer');
      expect(lease?.holds()).toBe(true);
      fs.renameSync(parent, moved);
      fs.symlinkSync(outside, parent);
      expect(lease?.holds()).toBe(false);
      lease?.release();
      expect(fs.readdirSync(outside)).toEqual([]);
      // Release reached the original directory and removed the marker; only its lock file stays.
      expect(fs.readdirSync(join(moved, '.writer'))).toEqual(['active.guard']);
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not redirect a write when a verified parent is replaced with an outside link',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-write-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-write-outside-'));
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
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-delete-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-delete-outside-'));
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
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-boundary-root-'));
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
    'replaces a file whole and owner-only, leaving no temp file behind',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-root-'));
      roots.push(root);
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      const boundary = createWorkspaceProjectMutationBoundary(identity, {
        resolve: () => identity,
      });

      boundary.replace('state/entry.json', 'first');
      fs.chmodSync(join(root, 'state', 'entry.json'), 0o644);
      boundary.replace('state/entry.json', Buffer.from('second'));

      expect(fs.readFileSync(join(root, 'state', 'entry.json'), 'utf8')).toBe('second');
      expect(fs.statSync(join(root, 'state', 'entry.json')).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(join(root, 'state'))).toEqual(['entry.json']);
    },
  );

  it.runIf(process.platform === 'linux')(
    'replaces a link at the target as an entry, never writing through it',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-link-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-link-outside-'));
      roots.push(root, outside);
      fs.writeFileSync(join(outside, 'entry.json'), 'outside canary');
      fs.symlinkSync(join(outside, 'entry.json'), join(root, 'entry.json'));
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });

      createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity }).replace(
        'entry.json',
        'inside',
      );

      expect(fs.readFileSync(join(outside, 'entry.json'), 'utf8')).toBe('outside canary');
      expect(fs.lstatSync(join(root, 'entry.json')).isFile()).toBe(true);
      expect(fs.readFileSync(join(root, 'entry.json'), 'utf8')).toBe('inside');
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not redirect a replace when a verified parent is replaced with an outside link',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-swap-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-swap-outside-'));
      roots.push(root, outside);
      const parent = join(root, 'state');
      const movedParent = join(root, 'state-original');
      fs.mkdirSync(parent);
      fs.writeFileSync(join(outside, 'entry.json'), 'outside canary');
      const identity = Object.freeze({
        repositoryKey: `test:${root}`,
        displayPath: root,
        worktreeRoot: root,
      });
      swap.armedParent = parent;
      swap.movedParent = movedParent;
      swap.outside = outside;

      createWorkspaceProjectMutationBoundary(identity, { resolve: () => identity }).replace(
        'state/entry.json',
        'inside',
      );

      expect(fs.readFileSync(join(outside, 'entry.json'), 'utf8')).toBe('outside canary');
      expect(fs.readFileSync(join(movedParent, 'entry.json'), 'utf8')).toBe('inside');
    },
  );

  it.runIf(process.platform === 'linux')(
    'refuses a final target symlink without touching its outside target',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-target-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-target-outside-'));
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
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-stale-root-'));
      const replacement = fs.mkdtempSync(join(tmpdir(), 'agent-project-stale-replacement-'));
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

  it.runIf(process.platform === 'linux')(
    'flushes the temp file before the rename and the directory after it',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-order-root-'));
      roots.push(root);

      boundaryFor(root).replace('state/entry.json', 'durable');

      const [flushTemporary, rename, flushDirectory, ...rest] = swap.calls;
      expect(flushTemporary).toMatch(/^fsync:.*\/state\/\.entry\.json\.[0-9a-f]{16}\.tmp$/);
      expect(rename).toBe(flushTemporary?.replace('fsync:', 'rename:'));
      expect(flushDirectory).toBe(`fsync:${join(fs.realpathSync(root), 'state')}`);
      expect(rest).toEqual([]);
    },
  );

  it.runIf(process.platform === 'linux')(
    'tolerates a filesystem with no directory flush but not another flush failure',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-replace-flush-root-'));
      roots.push(root);
      const boundary = boundaryFor(root);

      for (const code of ['EINVAL', 'ENOTSUP']) {
        swap.failDirectoryFsync = code;
        boundary.replace('entry.json', code);
        expect(fs.readFileSync(join(root, 'entry.json'), 'utf8')).toBe(code);
      }

      swap.failDirectoryFsync = 'EIO';
      expect(() => boundary.replace('entry.json', 'unconfirmed')).toThrowError(
        WorkspaceAuthorityRequiredError,
      );
    },
  );

  it.runIf(process.platform === 'linux')(
    'sweeps stale temp files of the replaced name and nothing else',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-sweep-replace-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-sweep-replace-outside-'));
      roots.push(root, outside);
      fs.writeFileSync(join(outside, 'canary.txt'), 'outside canary');
      const directory = join(root, 'state');
      const kept = seedTemporaries(directory, join(outside, 'canary.txt'));

      boundaryFor(root).replace('state/entry.json', 'replaced');

      expect(fs.readdirSync(directory).sort()).toEqual(['entry.json', ...kept].sort());
      expect(fs.readFileSync(join(directory, 'entry.json'), 'utf8')).toBe('replaced');
      const link = join(directory, '.entry.json.aaaaaaaaaaaaaaaa.tmp');
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(join(outside, 'canary.txt'), 'utf8')).toBe('outside canary');
      const nested = join(directory, '.entry.json.bbbbbbbbbbbbbbbb.tmp', 'inner');
      expect(fs.readFileSync(nested, 'utf8')).toBe('inner');
    },
  );

  it.runIf(process.platform === 'linux')(
    'sweeps stale temp files of the deleted name and nothing else',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-sweep-delete-root-'));
      const outside = fs.mkdtempSync(join(tmpdir(), 'agent-project-sweep-delete-outside-'));
      roots.push(root, outside);
      fs.writeFileSync(join(outside, 'canary.txt'), 'outside canary');
      const directory = join(root, 'state');
      const kept = seedTemporaries(directory, join(outside, 'canary.txt'));
      fs.writeFileSync(join(directory, 'entry.json'), 'present');
      const boundary = boundaryFor(root);

      expect(boundary.delete('state/entry.json')).toBe(true);
      expect(fs.readdirSync(directory).sort()).toEqual([...kept].sort());

      // Nothing is left to remove the second time, yet a crash can have left a temp file behind.
      fs.writeFileSync(join(directory, STALE_TEMPORARY), 'stale');
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      fs.utimesSync(join(directory, STALE_TEMPORARY), anHourAgo, anHourAgo);
      expect(boundary.delete('state/entry.json')).toBe(false);
      expect(fs.readdirSync(directory).sort()).toEqual([...kept].sort());
      expect(fs.readFileSync(join(outside, 'canary.txt'), 'utf8')).toBe('outside canary');
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not fail a replace or delete whose sweep fails, and sweeps the rest',
    () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-sweep-failure-root-'));
      roots.push(root);
      const directory = join(root, 'state');
      fs.mkdirSync(directory);
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const other = '.entry.json.1111111111111111.tmp';
      for (const name of [STALE_TEMPORARY, other]) {
        fs.writeFileSync(join(directory, name), 'stale');
        fs.utimesSync(join(directory, name), anHourAgo, anHourAgo);
      }
      swap.failUnlinkSuffix = STALE_TEMPORARY;
      const boundary = boundaryFor(root);

      expect(() => boundary.replace('state/entry.json', 'replaced')).not.toThrow();
      expect(fs.readFileSync(join(directory, 'entry.json'), 'utf8')).toBe('replaced');
      expect(fs.readdirSync(directory).sort()).toEqual([STALE_TEMPORARY, 'entry.json']);

      fs.writeFileSync(join(directory, other), 'stale');
      fs.utimesSync(join(directory, other), anHourAgo, anHourAgo);
      expect(boundary.delete('state/entry.json')).toBe(true);
      expect(fs.readdirSync(directory)).toEqual([STALE_TEMPORARY]);
    },
  );

  it('fails closed on hosts without stable root-anchored mutation support', () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'agent-project-unsupported-root-'));
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
      expect(supportsWorkspaceProjectMutation()).toBe(false);
    } finally {
      platform.mockRestore();
    }
  });

  it('tells a host in advance which platforms can write project state', () => {
    expect(supportsWorkspaceProjectMutation('linux')).toBe(true);
    for (const platform of ['darwin', 'win32', 'freebsd'] as const) {
      expect(supportsWorkspaceProjectMutation(platform)).toBe(false);
    }
    expect(supportsWorkspaceProjectMutation()).toBe(process.platform === 'linux');
  });
});
