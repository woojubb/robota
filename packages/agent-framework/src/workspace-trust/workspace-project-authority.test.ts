import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  assertWorkspaceProjectAuthority,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from './index.js';

import type {
  IWorkspaceProjectAuthority,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
} from './index.js';

// @ts-expect-error ARCH-042: a structural object cannot satisfy the opaque authority type.
const structurallyForgedAuthority: IWorkspaceProjectAuthority = {};
void structurallyForgedAuthority;

class MemoryTrustStore implements IWorkspaceTrustStore {
  private state: IWorkspaceTrustStoreSnapshot = {
    state: 'untrusted',
    generation: 0,
  };

  inspect(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve(this.state);
  }

  grant(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    expect(expectedGeneration).toBe(this.state.generation);
    this.state = {
      state: 'trusted',
      generation: this.state.generation + 1,
      grantedAt: '2026-08-22T00:00:00.000Z',
    };
    return Promise.resolve(this.state);
  }

  revoke(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    expect(expectedGeneration).toBe(this.state.generation);
    this.state = {
      state: 'revoked',
      generation: this.state.generation + 1,
    };
    return Promise.resolve(this.state);
  }
}

describe('WorkspaceTrustService project authority', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture(): {
    root: string;
    service: WorkspaceTrustService;
  } {
    const root = mkdtempSync(join(tmpdir(), 'robota-arch-042-'));
    roots.push(root);
    const identity: IWorkspaceIdentity = {
      repositoryKey: `test:${root}`,
      displayPath: root,
      worktreeRoot: root,
    };
    const identityResolver: IWorkspaceIdentityResolver = {
      resolve: () => identity,
    };
    return {
      root,
      service: new WorkspaceTrustService({
        identityResolver,
        store: new MemoryTrustStore(),
      }),
    };
  }

  it('returns Restricted until the host trust store grants the current identity', async () => {
    const { root, service } = fixture();

    await expect(service.inspect(root)).resolves.toEqual({
      status: 'restricted',
      reason: 'WorkspaceAuthorityRequired',
      trustState: 'untrusted',
      displayPath: root,
    });

    const granted = await service.grant(root);
    expect(granted.status).toBe('trusted');
    if (granted.status !== 'trusted') throw new Error('expected trusted access');
    expect(Object.isFrozen(granted.authority)).toBe(true);
    expect(assertWorkspaceProjectAuthority(granted.authority)).toBe(granted.authority);
  });

  it('rejects structural, reflected-property, serialized, and prototype forgeries', async () => {
    const { root, service } = fixture();
    const granted = await service.grant(root);
    if (granted.status !== 'trusted') throw new Error('expected trusted access');
    const legitimate = granted.authority;

    const reflectedCopy = Object.create(Object.getPrototypeOf(legitimate)) as Record<
      PropertyKey,
      unknown
    >;
    for (const key of Reflect.ownKeys(legitimate)) {
      const descriptor = Object.getOwnPropertyDescriptor(legitimate, key);
      if (descriptor !== undefined) Object.defineProperty(reflectedCopy, key, descriptor);
    }
    const serialized = JSON.parse(JSON.stringify(legitimate)) as object;
    const prototypeSpoof = Object.setPrototypeOf({}, Object.getPrototypeOf(legitimate));

    for (const candidate of [{}, reflectedCopy, serialized, prototypeSpoof]) {
      expect(() => assertWorkspaceProjectAuthority(candidate)).toThrowError(
        WorkspaceAuthorityRequiredError,
      );
    }
  });

  it('derives a root-relative reader that refuses traversal, absolute paths, and links', async () => {
    const { root, service } = fixture();
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'canary.txt'), 'trusted canary', 'utf8');
    const outside = mkdtempSync(join(tmpdir(), 'robota-arch-042-outside-'));
    roots.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'outside secret', 'utf8');
    symlinkSync(outside, join(root, 'linked-outside'));

    const granted = await service.grant(root);
    if (granted.status !== 'trusted') throw new Error('expected trusted access');
    const reader = getWorkspaceProjectReader(granted.authority);

    expect(reader.readText('nested/canary.txt', 'test canary')).toBe('trusted canary');
    expect(() => reader.readText('../secret.txt', 'test escape')).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
    expect(() => reader.readText(join(root, 'nested', 'canary.txt'), 'test absolute')).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
    expect(() => reader.readText('linked-outside/secret.txt', 'test link')).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
  });

  it('binds application state to a closed namespace and refuses linked write targets', async () => {
    const { root, service } = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'robota-arch-042-state-outside-'));
    roots.push(outside);
    mkdirSync(join(root, '.robota'), { recursive: true });
    symlinkSync(outside, join(root, '.robota', 'sessions'));

    const granted = await service.grant(root);
    if (granted.status !== 'trusted') throw new Error('expected trusted access');
    const sessions = getWorkspaceProjectStateStorage(granted.authority, 'sessions');

    expect(() => sessions.writeText('session.json', '{}', 'persist session')).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
    rmSync(join(root, '.robota', 'sessions'));
    sessions.writeText('session.json', '{"ok":true}', 'persist session');
    expect(sessions.readText('session.json', 'resume session')).toBe('{"ok":true}');
    expect(sessions.namespace).toBe('sessions');
  });

  it('binds an approved settings writer to exactly one project settings target', async () => {
    const { root, service } = fixture();
    const granted = await service.grant(root);
    if (granted.status !== 'trusted') throw new Error('expected trusted access');

    expect(() =>
      createWorkspaceProjectSettingsWriter(granted.authority, {
        status: 'denied',
        reason: 'test denial',
      }),
    ).toThrowError(WorkspaceAuthorityRequiredError);

    const writer = createWorkspaceProjectSettingsWriter(granted.authority, {
      status: 'approved',
      target: 'project-local',
      purpose: 'test settings update',
    });
    writer.writeText('{"permission":"allow"}\n');

    expect(
      getWorkspaceProjectReader(granted.authority).readText(
        '.robota/settings.local.json',
        'verify settings update',
      ),
    ).toBe('{"permission":"allow"}\n');
    expect(
      getWorkspaceProjectReader(granted.authority).readText(
        '.robota/settings.json',
        'verify unapproved target',
      ),
    ).toBeUndefined();
  });
});
