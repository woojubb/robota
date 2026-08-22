import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectSettingsWriter,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createCliWorkspaceComposition } from '../workspace-project-composition.js';

import type { IWorkspaceIdentity, IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function trustedAccess(root: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const snapshot: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CLI workspace project composition', () => {
  it('keeps project sources and state absent when the initial decision is restricted', () => {
    const cwd = tempRoot('robota-cli-restricted-project-');
    const userHome = tempRoot('robota-cli-restricted-user-');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    writeFileSync(join(cwd, '.robota', 'settings.json'), JSON.stringify({ canary: 'project' }));

    const composition = createCliWorkspaceComposition({
      cwd,
      userHome,
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    });

    expect(composition.projectAccess.status).toBe('restricted');
    expect(composition.contributionSources.map((source) => source.kind)).toEqual(['host']);
    expect(composition.settingsSources.map((source) => source.kind)).toEqual(['host', 'host']);
    expect(composition.settingsStores.map((store) => store.kind)).toEqual(['host']);
    expect(composition.memoryStore).toBeUndefined();
  });

  it('derives project readers and state only from the supplied trusted authority', async () => {
    const cwd = tempRoot('robota-cli-trusted-project-');
    const userHome = tempRoot('robota-cli-trusted-user-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');

    const composition = createCliWorkspaceComposition({ cwd, userHome, projectAccess: access });

    expect(composition.projectAccess).toBe(access);
    expect(composition.contributionSources.map((source) => source.kind)).toEqual([
      'project',
      'host',
    ]);
    expect(composition.settingsSources.map((source) => source.kind)).toEqual([
      'host',
      'host',
      'project',
      'project',
      'project',
      'project',
    ]);
    expect(composition.settingsStores.map((store) => store.kind)).toEqual(['host']);
    expect(composition.memoryStore).toBeDefined();

    composition.sessionStore.save({
      id: 'trusted-session',
      cwd,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      messages: [],
    });
    expect(composition.sessionStore.load('trusted-session')?.cwd).toBe(cwd);
  });

  it('adds a project settings store only with a writer minted for the same authority', async () => {
    const cwd = tempRoot('robota-cli-project-settings-');
    const userHome = tempRoot('robota-cli-project-settings-user-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');
    const writer = createWorkspaceProjectSettingsWriter(access.authority, {
      status: 'approved',
      target: 'project-local',
      purpose: 'CLI provider configuration test',
    });

    const composition = createCliWorkspaceComposition({
      cwd,
      userHome,
      projectAccess: access,
      projectSettingsWriter: writer,
    });

    expect(composition.settingsStores.map((store) => store.scope)).toEqual([
      'user',
      'project-local',
    ]);
  });
});
