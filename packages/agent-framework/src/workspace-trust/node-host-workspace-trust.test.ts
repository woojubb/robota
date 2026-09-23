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
