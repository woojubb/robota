import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { createProjectEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import { WorkspaceTrustService, getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import type { IWorkspaceProjectFiles, IWorkspaceTrustStore, TWorkspaceProjectStateDirectories } from '../../workspace-trust/index.js';

const STATE: TWorkspaceProjectStateDirectories = { sessions: '.state/sessions', 'session-logs': '.state/logs', memory: '.state/memory', checkpoints: '.state/checkpoints' };
const trust: IWorkspaceTrustStore = {
  inspect: async () => ({ state: 'trusted', generation: 1 }),
  grant: async () => ({ state: 'trusted', generation: 1 }),
  revoke: async () => ({ state: 'revoked', generation: 2 }),
};

it('uses a virtual project host writer capability without touching the local filesystem', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'virtual-checkpoint-host-')));
  const release = vi.fn();
  const handle = { holds: () => true, release };
  const acquireWriter = vi.fn(() => handle);
  const claimDirectory = vi.fn(() => true);
  const noop = () => {};
  const fail = (): never => { throw new Error('not used'); };
  const boundary = { acquireWriter, claimDirectory, write: noop, replace: noop, append: noop, delete: () => false, sweepTemporaries: () => 0, linkCount: () => undefined, stage: fail, commitStaged: noop, discardStaged: noop };
  const files: IWorkspaceProjectFiles = {
    readBytes: () => undefined,
    listDirectory: () => [],
    inspectKind: () => undefined,
    createMutationBoundary: () => boundary,
    createStableWriter: () => ({ assertNamedRoot: noop, writeUtf8WhileNamed: noop, close: noop }),
  };
  const identity = { repositoryKey: 'virtual', displayPath: root, worktreeRoot: root };
  try {
    const access = await new WorkspaceTrustService({ identityResolver: { resolve: () => identity }, store: trust, projectFiles: files, projectStateDirectories: STATE }).inspect(root);
    if (access.status !== 'trusted') throw new Error('fixture trust missing');
    const state = createProjectEditCheckpointState(getWorkspaceProjectStateStorage(access.authority, 'checkpoints'));
    const actual = state.acquireTurn?.('session_1', 'test');
    actual?.release();
    expect(acquireWriter).toHaveBeenCalledWith('.state/checkpoints/session_1/.writer');
    expect(release).toHaveBeenCalledOnce();
    expect(readdirSync(root)).toEqual([]);
    Object.defineProperty(boundary, 'acquireWriter', { value: undefined });
    expect(() => state.acquireTurn?.('session_1', 'test')).toThrow(/cannot acquire checkpoint writer leases/);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
