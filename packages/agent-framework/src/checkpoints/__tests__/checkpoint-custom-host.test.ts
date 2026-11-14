import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';

import { createSealedEditCheckpointState } from '../edit-checkpoint-sealed-state.js';
import { createProjectEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  getWorkspaceProjectStateStorage,
} from '../../workspace-trust/index.js';
import type {
  IWorkspaceProjectFiles,
  IWorkspaceTrustStore,
  TWorkspaceProjectStateDirectories,
} from '../../workspace-trust/index.js';

const STATE: TWorkspaceProjectStateDirectories = {
  sessions: '.state/sessions',
  'session-logs': '.state/logs',
  memory: '.state/memory',
  checkpoints: '.state/checkpoints',
};
const trust: IWorkspaceTrustStore = {
  inspect: async () => ({ state: 'trusted', generation: 1 }),
  grant: async () => ({ state: 'trusted', generation: 1 }),
  revoke: async () => ({ state: 'revoked', generation: 2 }),
};

it('uses a virtual project host writer capability without touching the local filesystem', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'virtual-checkpoint-host-')));
  const release = vi.fn();
  const handle = {
    holds: () => true,
    withGuard: <T>(operation: () => T) => ({ status: 'ran' as const, value: operation() }),
    release,
  };
  const acquireWriter = vi.fn(() => handle);
  const claimDirectory = vi.fn(() => true);
  const noop = () => {};
  const fail = (): never => {
    throw new Error('not used');
  };
  const boundary = {
    acquireWriter,
    claimDirectory,
    write: noop,
    replace: noop,
    append: () => true,
    delete: () => false,
    sweepTemporaries: () => 0,
    linkCount: () => undefined,
    stage: fail,
    commitStaged: noop,
    discardStaged: noop,
  };
  const files: IWorkspaceProjectFiles = {
    readBytes: () => undefined,
    listDirectory: () => [],
    inspectKind: () => undefined,
    createMutationBoundary: () => boundary,
    createStableWriter: () => ({ assertNamedRoot: noop, writeUtf8WhileNamed: noop, close: noop }),
  };
  const identity = { repositoryKey: 'virtual', displayPath: root, worktreeRoot: root };
  try {
    const access = await new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: trust,
      projectFiles: files,
      projectStateDirectories: STATE,
    }).inspect(root);
    if (access.status !== 'trusted') throw new Error('fixture trust missing');
    const state = createProjectEditCheckpointState(
      getWorkspaceProjectStateStorage(access.authority, 'checkpoints'),
    );
    const actual = state.acquireTurn?.('session_1', 'test');
    actual?.release();
    expect(acquireWriter).toHaveBeenCalledWith('.state/checkpoints/session_1/.writer');
    expect(release).toHaveBeenCalledOnce();
    expect(readdirSync(root)).toEqual([]);
    Object.defineProperty(boundary, 'acquireWriter', { value: undefined });
    expect(() => state.acquireTurn?.('session_1', 'test')).toThrow(
      /cannot acquire checkpoint writer leases/,
    );
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('forwards a directory removal from the state facets to the host boundary, and fails closed without one', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'virtual-removal-host-')));
  const noop = () => {};
  const removeDirectory = vi.fn(() => ({ status: 'partial' as const, reason: 'budget' as const }));
  const boundary = {
    removeDirectory,
    write: noop,
    replace: noop,
    append: () => true,
    delete: () => false,
    sweepTemporaries: () => 0,
    linkCount: () => undefined,
    stage: () => 'unused',
    commitStaged: noop,
    discardStaged: noop,
  };
  const files: IWorkspaceProjectFiles = {
    readBytes: () => undefined,
    listDirectory: () => [],
    inspectKind: () => undefined,
    createMutationBoundary: () => boundary,
    createStableWriter: () => ({ assertNamedRoot: noop, writeUtf8WhileNamed: noop, close: noop }),
  };
  const identity = { repositoryKey: 'virtual', displayPath: root, worktreeRoot: root };
  try {
    const access = await new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: trust,
      projectFiles: files,
      projectStateDirectories: STATE,
    }).inspect(root);
    if (access.status !== 'trusted') throw new Error('fixture trust missing');
    const storage = getWorkspaceProjectStateStorage(access.authority, 'checkpoints');
    const sealed = createSealedEditCheckpointState(createProjectEditCheckpointState(storage), {
      sealer: createTestArtifactSealer(),
    });

    expect(sealed.removeDirectory?.('session_1', 'test', { maxEntries: 5 })).toEqual({
      status: 'partial',
      reason: 'budget',
    });
    expect(removeDirectory).toHaveBeenCalledWith('.state/checkpoints/session_1', { maxEntries: 5 });
    expect(() => storage.removeDirectory?.('session_1', ' ')).toThrow(
      WorkspaceAuthorityRequiredError,
    );
    expect(() => storage.removeDirectory?.('', 'test')).toThrow(WorkspaceAuthorityRequiredError);

    Object.defineProperty(boundary, 'removeDirectory', { value: undefined });
    expect(() => sealed.removeDirectory?.('session_1', 'test')).toThrow(
      /cannot remove directories/,
    );
    expect(removeDirectory).toHaveBeenCalledOnce();
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
