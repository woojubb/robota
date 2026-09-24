import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceTrustService } from './workspace-trust-service.js';
import { getWorkspaceProjectStateStorage } from './project-state-storage.js';
import { validateWorkspaceSessionReplayLog } from '../interactive/workspace-session-replay-validation.js';
import { createWorkspaceProjectMutation } from './project-mutation.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';

import type { IWorkspaceIdentity, TWorkspaceProjectStateDirectories } from './types.js';

const roots: string[] = [];
const directories: TWorkspaceProjectStateDirectories = {
  sessions: join('.custom-state', 'sessions'),
  'session-logs': join('.custom-state', 'logs'),
  memory: join('.custom-state', 'memory'),
  checkpoints: join('.custom-state', 'checkpoints'),
};

function service(projectStateDirectories?: TWorkspaceProjectStateDirectories) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-state-root-')));
  roots.push(root);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `test:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  return {
    root,
    trust: new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: {
        inspect: async () => ({ state: 'trusted', generation: 1 }),
        grant: async () => ({ state: 'trusted', generation: 1 }),
        revoke: async () => ({ state: 'revoked', generation: 2 }),
      },
      ...(projectStateDirectories === undefined ? {} : { projectStateDirectories }),
    }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('host-selected project state directories', () => {
  it('uses one immutable authority snapshot for every state facet and replay display', async () => {
    const hostMap = { ...directories };
    const { root, trust } = service(hostMap);
    const access = await trust.inspect(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    hostMap.sessions = join('.retargeted', 'sessions');

    for (const [namespace, relativeRoot] of Object.entries(directories)) {
      const probe = join(root, relativeRoot, 'probe.txt');
      mkdirSync(dirname(probe), { recursive: true });
      writeFileSync(probe, namespace);
      const storage = getWorkspaceProjectStateStorage(
        access.authority,
        namespace as keyof TWorkspaceProjectStateDirectories,
      );
      expect(storage.projectRelativePath('probe.txt')).toBe(join(relativeRoot, 'probe.txt'));
      expect(storage.readText('probe.txt', 'test host-selected state read')).toBe(namespace);
    }
    expect(validateWorkspaceSessionReplayLog(access, 'session_1').logFile).toBe(
      join(directories['session-logs'], 'session_1.jsonl'),
    );
  });

  it('refuses state access when the host did not select namespace directories', async () => {
    const { root, trust } = service();
    const access = await trust.inspect(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');

    expect(() => getWorkspaceProjectStateStorage(access.authority, 'sessions')).toThrow(
      /state director/i,
    );
  });

  it('rejects traversal and overlapping host roots before issuing authority', () => {
    expect(() => service({ ...directories, sessions: '../escape' })).toThrow(/project read/i);
    expect(() => service({ ...directories, sessions: directories.memory })).toThrow(/overlap/i);
  });

  it.runIf(process.platform === 'linux')(
    'reads and writes every namespace under the host-selected project paths',
    async () => {
      const { root, trust } = service(directories);
      const access = await trust.inspect(root);
      if (access.status !== 'trusted') throw new Error('Expected trusted project access.');

      for (const [namespace, relativeRoot] of Object.entries(directories)) {
        const storage = getWorkspaceProjectStateStorage(
          access.authority,
          namespace as keyof TWorkspaceProjectStateDirectories,
        );
        storage.writeText('probe.txt', namespace, 'test host-selected state write');
        expect(storage.readText('probe.txt', 'test host-selected state read')).toBe(namespace);
        expect(existsSync(join(root, relativeRoot, 'probe.txt'))).toBe(true);
      }
      expect(existsSync(join(root, '.robota', 'sessions', 'probe.txt'))).toBe(false);
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not checkpoint files inside the host-selected checkpoint root',
    async () => {
      const { root, trust } = service(directories);
      const access = await trust.inspect(root);
      if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
      const target = join(root, directories.checkpoints, 'existing.txt');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'checkpoint state');
      const mutation = createWorkspaceProjectMutation(access.authority, {
        status: 'approved',
        purpose: 'test checkpoint capture exclusion',
      });
      const store = new EditCheckpointStore({ authority: access.authority, mutation });

      await store.beginTurn({ sessionId: 'session_1', prompt: 'test' });
      await store.captureFile(target);
      const summary = await store.finalizeTurn();
      expect(summary?.fileCount).toBe(0);
    },
  );
});
