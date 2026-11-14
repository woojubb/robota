import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

/**
 * One-shot interceptions of the filesystem calls the removal makes, keyed by the path the call names
 * once `/proc/self/fd/<n>` is resolved: each runs just before the real call, the way a concurrent
 * same-user process could act between two of the removal's steps.
 */
const hooks = vi.hoisted(() => ({
  open: [] as { path: string; nth: number; seen: number; act: () => void }[],
  unlink: [] as { path: string; act: () => void }[],
  rmdir: [] as { path: string; act: () => void }[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  // The removal names entries by bytes; every name these hooks watch is valid UTF-8.
  const logical = (raw: string | Buffer): string => {
    const path = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    const match = /^\/proc\/self\/fd\/(\d+)\/(.+)$/su.exec(path);
    if (match === null) return path;
    return `${actual.realpathSync(`/proc/self/fd/${match[1]}`)}/${match[2]}`;
  };
  const fire = (list: { path: string; act: () => void }[], path: string | Buffer): void => {
    if (list.length === 0) return;
    const resolved = logical(path);
    const index = list.findIndex((hook) => hook.path === resolved);
    if (index >= 0) list.splice(index, 1)[0]!.act();
  };
  return {
    ...actual,
    openSync(path: string | Buffer, flags: number, mode?: number) {
      if (hooks.open.length > 0) {
        const resolved = logical(path);
        const index = hooks.open.findIndex((hook) => hook.path === resolved);
        const hook = hooks.open[index];
        if (hook !== undefined && ++hook.seen === hook.nth) {
          hooks.open.splice(index, 1);
          hook.act();
        }
      }
      return actual.openSync(path, flags, mode);
    },
    unlinkSync(path: string | Buffer) {
      fire(hooks.unlink, path);
      actual.unlinkSync(path);
    },
    rmdirSync(path: string | Buffer) {
      fire(hooks.rmdir, path);
      actual.rmdirSync(path);
    },
  };
});

const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
const { createWorkspaceProjectMutationBoundary } = await import('./project-relative-writer.js');
const { readProcMountId } = await import('./project-directory-removal.js');

const linux = process.platform === 'linux';
const created: string[] = [];
const servers: Server[] = [];
const mounts: string[] = [];

afterEach(async () => {
  hooks.open.length = 0;
  hooks.unlink.length = 0;
  hooks.rmdir.length = 0;
  for (const mount of mounts.splice(0).reverse()) execFileSync('umount', [mount]);
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const path of created.splice(0)) fs.rmSync(path, { recursive: true, force: true });
});

interface IFixture {
  readonly root: string;
  readonly victim: string;
  readonly outside: string;
  readonly canary: string;
}

/** A trusted root holding `state/victim`, and a directory beside the root with a canary file in it. */
function fixture(): IFixture {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'project-removal-')));
  created.push(base);
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  const victim = join(root, 'state', 'victim');
  fs.mkdirSync(victim, { recursive: true });
  fs.mkdirSync(outside);
  const canary = join(outside, 'canary.txt');
  fs.writeFileSync(canary, 'CANARY');
  return { root, victim, outside, canary };
}

function boundaryFor(
  root: string,
  readMountId?: (descriptor: number) => string,
): ReturnType<typeof createWorkspaceProjectMutationBoundary> {
  const identity = Object.freeze({
    repositoryKey: `test:${root}`,
    displayPath: root,
    worktreeRoot: root,
  });
  return createWorkspaceProjectMutationBoundary(
    identity,
    { resolve: () => identity },
    readMountId === undefined ? {} : { readMountId },
  );
}

function remove(
  boundary: ReturnType<typeof createWorkspaceProjectMutationBoundary>,
  path: string,
  options?: { maxEntries?: number; maxMs?: number },
) {
  if (boundary.removeDirectory === undefined) throw new Error('directory removal missing');
  return boundary.removeDirectory(path, options);
}

function expectCanaryIntact(f: IFixture): void {
  expect(fs.readFileSync(f.canary, 'utf8')).toBe('CANARY');
  expect(fs.readdirSync(f.outside)).toContain('canary.txt');
}

/** Whether this process may mount: the bind-mount evidence runs only where it really can. */
function canMount(probe: string): boolean {
  try {
    execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', probe], { stdio: 'ignore' });
    execFileSync('umount', [probe], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('project directory removal', () => {
  it('refuses on a host that cannot anchor project mutation', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: linux ? 'darwin' : process.platform });
    try {
      const boundary = boundaryFor(join(fixture().root, 'never-opened'));
      expect(() => remove(boundary, 'state/victim')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, 'state/victim')).toThrow(/only on Linux/u);
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });

  it.runIf(linux)(
    'removes a nested tree, unlinking sockets, FIFOs and links by name, and reports what it did',
    async () => {
      const f = fixture();
      fs.mkdirSync(join(f.victim, 'nested', 'deeper', 'deepest'), { recursive: true });
      fs.mkdirSync(join(f.victim, 'empty'));
      fs.writeFileSync(join(f.victim, 'top.txt'), 'top');
      fs.writeFileSync(join(f.victim, 'nested', 'deeper', 'leaf.txt'), 'leaf');
      execFileSync('mkfifo', [join(f.victim, 'nested', 'pipe')]);
      const server = createServer();
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(join(f.victim, 'sock'), resolve));
      fs.symlinkSync(f.outside, join(f.victim, 'dir-link'));
      fs.symlinkSync(f.canary, join(f.victim, 'nested', 'file-link'));
      fs.symlinkSync(join(f.root, 'missing'), join(f.victim, 'dangling'));
      fs.linkSync(f.canary, join(f.victim, 'hard-link'));
      const boundary = boundaryFor(f.root);

      expect(remove(boundary, 'state/victim')).toEqual({ status: 'removed' });
      expect(fs.existsSync(f.victim)).toBe(false);
      expect(fs.readdirSync(join(f.root, 'state'))).toEqual([]);
      expectCanaryIntact(f);
      expect(fs.statSync(f.canary).nlink).toBe(1);

      expect(remove(boundary, 'state/victim')).toEqual({ status: 'absent' });
      expect(remove(boundary, 'missing/ancestor/victim')).toEqual({ status: 'absent' });
      expect(fs.existsSync(join(f.root, 'missing'))).toBe(false);
    },
  );

  it.runIf(linux)('removes entries whose names are not valid UTF-8 in one call', () => {
    const f = fixture();
    const named = (directory: string, ...bytes: number[][]): Buffer =>
      Buffer.concat([Buffer.from(`${directory}/`), ...bytes.map((part) => Buffer.from(part))]);
    fs.writeFileSync(join(f.victim, 'ok.txt'), 'ok');
    fs.writeFileSync(named(f.victim, [0x66, 0xff]), 'f-ff');
    fs.writeFileSync(named(f.victim, [0xff]), 'ff');
    const directory = named(f.victim, [0x64, 0xc3, 0x28]);
    fs.mkdirSync(directory);
    fs.writeFileSync(Buffer.concat([directory, Buffer.from('/inner.txt')]), 'inner');
    fs.symlinkSync(f.canary, named(f.victim, [0xfe, 0x6c]));

    expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({ status: 'removed' });
    expect(fs.existsSync(f.victim)).toBe(false);
    expectCanaryIntact(f);
  });

  it.runIf(linux)('removes entries whose names hold characters a URL would treat specially', () => {
    const f = fixture();
    for (const name of ['with space', 'hash#tag', 'per%20cent', 'what?', 'new\nline', 'ünï']) {
      fs.mkdirSync(join(f.victim, `${name}-dir`));
      fs.writeFileSync(join(f.victim, `${name}-dir`, name), name);
      fs.writeFileSync(join(f.victim, name), name);
    }

    expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({ status: 'removed' });
    expect(fs.existsSync(f.victim)).toBe(false);
  });

  it.runIf(linux)(
    'refuses a linked or non-directory ancestor, a replaced root and a target that is a link, a file or a mount point',
    () => {
      const f = fixture();
      fs.mkdirSync(join(f.outside, 'victim'));
      fs.writeFileSync(join(f.outside, 'victim', 'kept.txt'), 'kept');
      fs.symlinkSync(f.outside, join(f.root, 'linked'));
      fs.writeFileSync(join(f.root, 'file.txt'), 'file');
      fs.symlinkSync(join(f.outside, 'victim'), join(f.root, 'state', 'link-target'));
      fs.writeFileSync(join(f.victim, 'inside.txt'), 'inside');
      const boundary = boundaryFor(f.root);

      expect(() => remove(boundary, 'linked/victim')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, 'file.txt/victim')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, 'state/link-target')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, 'file.txt')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, '')).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => remove(boundary, '../outside')).toThrow(WorkspaceAuthorityRequiredError);
      expect(fs.readFileSync(join(f.outside, 'victim', 'kept.txt'), 'utf8')).toBe('kept');

      const spelledThroughLink = join(f.root, '..', 'root-link');
      fs.symlinkSync(f.root, spelledThroughLink);
      expect(() => remove(boundaryFor(spelledThroughLink), 'state/victim')).toThrow(
        WorkspaceAuthorityRequiredError,
      );

      const mountedVictim = boundaryFor(f.root, (descriptor) =>
        fs.realpathSync(`/proc/self/fd/${descriptor}`) === f.victim
          ? 'another-mount'
          : readProcMountId(descriptor),
      );
      expect(() => remove(mountedVictim, 'state/victim')).toThrow(/another mount/u);
      expect(fs.readFileSync(join(f.victim, 'inside.txt'), 'utf8')).toBe('inside');
      expectCanaryIntact(f);
    },
  );

  it.runIf(linux)('never follows a link swapped in before it descends into a child', () => {
    const f = fixture();
    fs.mkdirSync(join(f.victim, 'child'));
    fs.writeFileSync(join(f.victim, 'child', 'inner.txt'), 'inner');
    const moved = join(f.root, 'moved-child');
    hooks.open.push({
      path: join(f.victim, 'child'),
      nth: 1,
      seen: 0,
      act: () => {
        fs.renameSync(join(f.victim, 'child'), moved);
        fs.symlinkSync(f.outside, join(f.victim, 'child'));
      },
    });

    expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({ status: 'removed' });
    expect(hooks.open).toEqual([]);
    expectCanaryIntact(f);
    expect(fs.readFileSync(join(moved, 'inner.txt'), 'utf8')).toBe('inner');
  });

  it.runIf(linux)(
    'unlinks a link swapped in between listing and unlinking a child, not its target',
    () => {
      const f = fixture();
      fs.writeFileSync(join(f.victim, 'file.txt'), 'file');
      hooks.unlink.push({
        path: join(f.victim, 'file.txt'),
        act: () => {
          fs.unlinkSync(join(f.victim, 'file.txt'));
          fs.symlinkSync(f.canary, join(f.victim, 'file.txt'));
        },
      });

      expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({ status: 'removed' });
      expect(hooks.unlink).toEqual([]);
      expectCanaryIntact(f);
    },
  );

  it.runIf(linux)(
    'descends into a directory swapped in where a file was listed, never out of the tree',
    () => {
      const f = fixture();
      fs.writeFileSync(join(f.victim, 'entry'), 'file');
      hooks.unlink.push({
        path: join(f.victim, 'entry'),
        act: () => {
          fs.unlinkSync(join(f.victim, 'entry'));
          fs.mkdirSync(join(f.victim, 'entry'));
          fs.symlinkSync(f.canary, join(f.victim, 'entry', 'link'));
        },
      });

      expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({ status: 'removed' });
      expect(fs.existsSync(f.victim)).toBe(false);
      expectCanaryIntact(f);
    },
  );

  it.runIf(linux)(
    'refuses, and leaves in place, a directory or link swapped in under the name just before rmdir',
    () => {
      for (const level of ['victim', 'child'] as const) {
        for (const replacement of ['directory', 'link'] as const) {
          const f = fixture();
          fs.mkdirSync(join(f.victim, 'child'));
          fs.writeFileSync(join(f.victim, 'child', 'inner.txt'), 'inner');
          const name = level === 'victim' ? f.victim : join(f.victim, 'child');
          // The first open pins the directory; the second is the recheck right before its rmdir.
          hooks.open.push({
            path: name,
            nth: 2,
            seen: 0,
            act: () => {
              fs.renameSync(name, `${name}-original`);
              if (replacement === 'directory') fs.mkdirSync(name);
              else fs.symlinkSync(f.outside, name);
            },
          });

          expect(() => remove(boundaryFor(f.root), 'state/victim')).toThrow(/replaced/u);
          expect(hooks.open).toEqual([]);
          if (replacement === 'directory') {
            expect(fs.lstatSync(name).isDirectory()).toBe(true);
            expect(fs.readdirSync(name)).toEqual([]);
          } else {
            expect(fs.lstatSync(name).isSymbolicLink()).toBe(true);
          }
          expect(fs.readdirSync(`${name}-original`)).toEqual([]);
          expectCanaryIntact(f);
        }
      }
    },
  );

  it.runIf(linux)(
    'leaves a non-empty replacement swapped in after the recheck and reports a partial removal',
    () => {
      const f = fixture();
      hooks.rmdir.push({
        path: f.victim,
        act: () => {
          fs.renameSync(f.victim, `${f.victim}-original`);
          fs.mkdirSync(f.victim);
          fs.writeFileSync(join(f.victim, 'replacement.txt'), 'replacement');
        },
      });

      expect(remove(boundaryFor(f.root), 'state/victim')).toEqual({
        status: 'partial',
        reason: 'concurrent',
      });
      expect(fs.readFileSync(join(f.victim, 'replacement.txt'), 'utf8')).toBe('replacement');
    },
  );

  it.runIf(linux)('refuses to descend into a directory on another mount', () => {
    const f = fixture();
    fs.mkdirSync(join(f.victim, 'mounted'));
    fs.writeFileSync(join(f.victim, 'mounted', 'canary.txt'), 'MOUNTED-CANARY');
    const mounted = join(f.victim, 'mounted');
    const boundary = boundaryFor(f.root, (descriptor) =>
      fs.realpathSync(`/proc/self/fd/${descriptor}`) === mounted
        ? 'another-mount'
        : readProcMountId(descriptor),
    );

    expect(() => remove(boundary, 'state/victim')).toThrow(/another mount/u);
    expect(fs.readFileSync(join(mounted, 'canary.txt'), 'utf8')).toBe('MOUNTED-CANARY');
  });

  it.runIf(linux)(
    'stops at a real bind or tmpfs mount inside the tree and at a mounted target',
    (context) => {
      const f = fixture();
      if (!canMount(f.outside)) {
        context.skip();
        return;
      }
      const bound = join(f.victim, 'bound');
      fs.mkdirSync(bound);
      execFileSync('mount', ['--bind', f.outside, bound]);
      mounts.push(bound);
      // A bind mount shows the same device number, which is why the mount id decides.
      expect(fs.statSync(bound).dev).toBe(fs.statSync(f.victim).dev);
      expect(() => remove(boundaryFor(f.root), 'state/victim')).toThrow(/another mount/u);
      expectCanaryIntact(f);
      execFileSync('umount', [mounts.pop()!]);

      const scratch = join(f.victim, 'scratch');
      fs.mkdirSync(scratch, { recursive: true });
      execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', scratch]);
      mounts.push(scratch);
      fs.writeFileSync(join(scratch, 'tmpfs-canary.txt'), 'TMPFS');
      expect(() => remove(boundaryFor(f.root), 'state/victim')).toThrow(/another mount/u);
      expect(fs.readFileSync(join(scratch, 'tmpfs-canary.txt'), 'utf8')).toBe('TMPFS');
      execFileSync('umount', [mounts.pop()!]);

      const target = join(f.root, 'state', 'mounted-target');
      fs.mkdirSync(target);
      execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', target]);
      mounts.push(target);
      fs.writeFileSync(join(target, 'kept.txt'), 'kept');
      expect(() => remove(boundaryFor(f.root), 'state/mounted-target')).toThrow(/another mount/u);
      expect(fs.readFileSync(join(target, 'kept.txt'), 'utf8')).toBe('kept');
    },
  );

  it.runIf(linux)('stops at its entry budget with a partial result that a retry finishes', () => {
    const f = fixture();
    fs.mkdirSync(join(f.victim, 'nested'));
    for (let index = 0; index < 6; index += 1) {
      fs.writeFileSync(join(f.victim, `file-${index}`), 'x');
      fs.writeFileSync(join(f.victim, 'nested', `file-${index}`), 'x');
    }
    const boundary = boundaryFor(f.root);

    expect(remove(boundary, 'state/victim', { maxEntries: 3 })).toEqual({
      status: 'partial',
      reason: 'budget',
    });
    expect(fs.existsSync(f.victim)).toBe(true);
    let calls = 1;
    let result = remove(boundary, 'state/victim', { maxEntries: 1 });
    while (result.status === 'partial' && calls < 50) {
      calls += 1;
      result = remove(boundary, 'state/victim', { maxEntries: 1 });
    }
    expect(result).toEqual({ status: 'removed' });
    expect(calls).toBeGreaterThan(5);
    expect(fs.existsSync(f.victim)).toBe(false);

    for (const options of [
      { maxEntries: 0 },
      { maxEntries: 1.5 },
      { maxMs: 0 },
      { maxMs: 60_000 },
    ]) {
      expect(() => remove(boundary, 'state/victim', options)).toThrow(/budget/u);
    }
  });

  it.runIf(linux)(
    'reports a partial removal when an entry appears while it empties a directory',
    () => {
      const f = fixture();
      fs.writeFileSync(join(f.victim, 'old.txt'), 'old');
      hooks.rmdir.push({
        path: f.victim,
        act: () => fs.writeFileSync(join(f.victim, 'new.txt'), 'new'),
      });
      const boundary = boundaryFor(f.root);

      expect(remove(boundary, 'state/victim')).toEqual({ status: 'partial', reason: 'concurrent' });
      expect(fs.readdirSync(f.victim)).toEqual(['new.txt']);
      expect(remove(boundary, 'state/victim')).toEqual({ status: 'removed' });
    },
  );
});
