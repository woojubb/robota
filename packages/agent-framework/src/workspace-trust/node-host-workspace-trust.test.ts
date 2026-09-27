import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkspaceTrustService,
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustStore,
} from './index.js';
import { repositoryKeyFromStats } from './node-host-workspace-trust.js';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function gitInit(root: string): void {
  execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Node host workspace trust', () => {
  it('resolves the same repository identity from a nested working directory', () => {
    const root = tempRoot('robota-workspace-nested-cwd-');
    gitInit(root);
    const nested = join(root, 'packages', 'example');
    mkdirSync(nested, { recursive: true });
    const resolver = createNodeWorkspaceIdentityResolver();

    expect(resolver.resolve(nested)).toEqual(resolver.resolve(root));
  });

  it('uses the canonical Git identity for aliases and grants only the current generation', async () => {
    const root = tempRoot('robota-workspace-trust-');
    gitInit(root);
    const alias = join(tempRoot('robota-workspace-alias-'), 'repo');
    symlinkSync(root, alias);
    const storePath = join(tempRoot('robota-workspace-store-'), 'workspace-trust.json');
    const resolver = createNodeWorkspaceIdentityResolver();
    const store = createNodeWorkspaceTrustStore(storePath);
    const service = new WorkspaceTrustService({ identityResolver: resolver, store });

    const identity = resolver.resolve(root);
    expect(resolver.resolve(alias)).toEqual(identity);
    await expect(service.inspect(root)).resolves.toMatchObject({
      status: 'restricted',
      trustState: 'untrusted',
      displayPath: root,
    });

    const granted = await service.grant(alias);
    expect(granted).toMatchObject({ status: 'trusted', identity });
    await expect(service.inspect(root)).resolves.toMatchObject({
      status: 'trusted',
      identity,
    });

    const revoked = await service.revoke(root);
    expect(revoked).toMatchObject({ status: 'restricted', trustState: 'revoked' });
    await expect(service.inspect(alias)).resolves.toMatchObject({
      status: 'restricted',
      trustState: 'revoked',
    });
  });

  it('does not inherit a grant when the repository at the same path is replaced', async () => {
    const root = tempRoot('robota-workspace-replacement-');
    gitInit(root);
    const store = createNodeWorkspaceTrustStore(
      join(tempRoot('robota-workspace-store-'), 'trust.json'),
    );
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store,
    });

    await service.grant(root);
    const originalKey = createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey;
    rmSync(join(root, '.git'), { recursive: true, force: true });
    gitInit(root);

    const replacement = await service.inspect(root);
    expect(replacement).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    expect(createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey).not.toBe(originalKey);
  });

  /** Whether this filesystem reports a birth time the key can use (the production predicate). */
  function reportsBirthTime(): boolean {
    const probe = tempRoot('robota-workspace-birth-');
    writeFileSync(join(probe, 'touch'), '');
    const stat = statSync(probe, { bigint: true });
    return stat.birthtimeNs > 0n && stat.birthtimeNs < stat.ctimeNs;
  }

  it.skipIf(!reportsBirthTime())(
    'keeps a grant across git commands that rewrite the repository config',
    async () => {
      const root = tempRoot('robota-workspace-config-');
      gitInit(root);
      const git = (...args: string[]): void => {
        execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
      };
      git(
        '-c',
        'user.name=robota',
        '-c',
        'user.email=robota@example.invalid',
        'commit',
        '--allow-empty',
        '--quiet',
        '--no-gpg-sign',
        '-m',
        'init',
      );
      const service = new WorkspaceTrustService({
        identityResolver: createNodeWorkspaceIdentityResolver(),
        store: createNodeWorkspaceTrustStore(
          join(tempRoot('robota-workspace-store-'), 'trust.json'),
        ),
      });
      await service.grant(root);
      const key = createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey;

      // Each of these replaces .git/config with a new file (new inode and ctime).
      git('config', 'robota.probe', 'one');
      git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
      git('branch', 'feature');
      git('branch', '-m', 'feature', 'renamed');
      git('branch', '-D', 'renamed');

      expect(createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey).toBe(key);
      await expect(service.inspect(root)).resolves.toMatchObject({ status: 'trusted' });
    },
  );

  it('keys a repository without the device number, which macOS renumbers', () => {
    const root = tempRoot('robota-workspace-device-');
    gitInit(root);
    const key = createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey;
    const device = statSync(join(root, '.git'), { bigint: true }).dev.toString(16);

    expect(key.split(':')).not.toContain(device);
  });

  it('a new grant replaces a record left for the same worktree under an earlier key', async () => {
    const root = tempRoot('robota-workspace-rekey-');
    gitInit(root);
    const storePath = join(tempRoot('robota-workspace-store-'), 'trust.json');
    // A grant recorded under the previous key format, which no longer matches this repository.
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        grants: [
          {
            repositoryKey: `git:100000e:2fa610c:100000e:c311bd0:18d8f41edb880a6d:${join(root, '.git')}`,
            worktreeRoot: root,
            state: 'trusted',
            generation: 1,
          },
        ],
      }),
    );
    const store = createNodeWorkspaceTrustStore(storePath);
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store,
    });
    await expect(service.inspect(root)).resolves.toMatchObject({ trustState: 'untrusted' });

    await service.grant(root);

    const persisted = JSON.parse(readFileSync(storePath, 'utf8')) as {
      grants: { repositoryKey: string; worktreeRoot: string }[];
    };
    const grants = persisted.grants.filter((grant) => grant.worktreeRoot === root);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.repositoryKey).toBe(
      createNodeWorkspaceIdentityResolver().resolve(root).repositoryKey,
    );
  });

  it('resolves nested repositories independently and distinguishes linked worktrees', () => {
    const outer = tempRoot('robota-workspace-outer-');
    const nested = join(outer, 'nested');
    mkdirSync(nested);
    gitInit(outer);
    gitInit(nested);
    const resolver = createNodeWorkspaceIdentityResolver();
    const outerIdentity = resolver.resolve(outer);
    const nestedIdentity = resolver.resolve(nested);
    expect(nestedIdentity.worktreeRoot).toBe(nested);
    expect(nestedIdentity.repositoryKey).not.toBe(outerIdentity.repositoryKey);

    const parent = tempRoot('robota-workspace-worktrees-');
    const main = join(parent, 'main');
    const linked = join(parent, 'linked');
    mkdirSync(main);
    gitInit(main);
    writeFileSync(join(main, 'README.md'), 'worktree fixture', 'utf8');
    execFileSync('git', ['-C', main, 'add', 'README.md'], { stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-C',
        main,
        '-c',
        'user.name=Robota Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('git', ['-C', main, 'worktree', 'add', '--quiet', linked], { stdio: 'ignore' });
    const mainIdentity = resolver.resolve(main);
    const linkedIdentity = resolver.resolve(linked);
    expect(linkedIdentity.repositoryKey).toBe(mainIdentity.repositoryKey);
    expect(linkedIdentity.worktreeRoot).not.toBe(mainIdentity.worktreeRoot);
  });

  it('rejects non-Git paths and corrupt or group-readable trust stores', async () => {
    const root = tempRoot('robota-workspace-non-git-');
    const resolver = createNodeWorkspaceIdentityResolver();
    expect(() => resolver.resolve(root)).toThrow(/Git workspace identity/i);

    const storeRoot = tempRoot('robota-workspace-store-');
    const storePath = join(storeRoot, 'trust.json');
    writeFileSync(storePath, '{not-json', 'utf8');
    chmodSync(storePath, 0o644);
    const store = createNodeWorkspaceTrustStore(storePath);
    const identity = {
      repositoryKey: 'git:fixture',
      displayPath: root,
      worktreeRoot: root,
    };
    await expect(store.inspect(identity)).rejects.toThrow(/corrupt|invalid/i);
    expect(readFileSync(storePath, 'utf8')).toContain('not-json');
  });

  it('keeps the persistent store owner-only and supports a clean restart', async () => {
    const root = tempRoot('robota-workspace-persist-');
    gitInit(root);
    const storeRoot = tempRoot('robota-workspace-store-');
    const storePath = join(storeRoot, 'trust.json');
    const resolver = createNodeWorkspaceIdentityResolver();
    const identity = resolver.resolve(root);
    await expect(
      new WorkspaceTrustService({
        identityResolver: resolver,
        store: createNodeWorkspaceTrustStore(storePath),
      }).grant(root),
    ).resolves.toMatchObject({ status: 'trusted' });

    expect(readFileSync(storePath, 'utf8')).toContain('"version": 1');
    const mode = statSync(storePath).mode & 0o777;
    expect(mode).toBe(0o600);
    await expect(createNodeWorkspaceTrustStore(storePath).inspect(identity)).resolves.toMatchObject(
      {
        state: 'trusted',
        generation: 1,
      },
    );
  });
});

describe('repository key', () => {
  const config = { ino: 0x51n, ctimeNs: 0x900n };
  const key = (birthtimeNs: bigint, ctimeNs = 0x800n, cfg = config): string =>
    repositoryKeyFromStats('/w/.git', { ino: 0x2an, birthtimeNs, ctimeNs }, () => cfg);

  it('uses the directory birth time when the filesystem records one', () => {
    expect(key(0x700n)).toBe('git:born:2a:700:/w/.git');
  });

  it.each([
    ['zero (statx without a birth time)', 0n],
    ['the change time (libuv without statx)', 0x800n],
    ['negative (FreeBSD without a birth time)', -1_000_000_000n],
  ])('falls back to the config file when the birth time is %s', (_label, birthtimeNs) => {
    expect(key(birthtimeNs)).toBe('git:2a:51:900:/w/.git');
  });

  it('the fallback still changes when the repository is recreated, and names no device', () => {
    const recreated = key(0n, 0x800n, { ino: 0x77n, ctimeNs: 0xa00n });
    expect(recreated).not.toBe(key(0n));
    expect(recreated.split(':')).toHaveLength(5);
  });
});
