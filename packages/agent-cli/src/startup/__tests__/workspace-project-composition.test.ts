import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createCliWorkspaceComposition } from '../workspace-project-composition.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../../product/robota-project-state-directories.js';
import { listProjectContributionPaths } from '../project-contribution-preview.js';
import { ROBOTA_SKILL_ROOTS } from '../../product/robota-skill-roots.js';
import { SkillCommandSource } from '@robota-sdk/agent-framework';

import type { IWorkspaceIdentity, IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

async function trustedAccess(
  root: string,
  projectStateDirectories = ROBOTA_PROJECT_STATE_DIRECTORIES,
) {
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
    projectStateDirectories,
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
    mkdirSync(join(cwd, '.robota', 'skills', 'project-only'), { recursive: true });
    writeFileSync(
      join(cwd, '.robota', 'skills', 'project-only', 'SKILL.md'),
      '---\nname: project-only\n---\n',
    );

    const composition = createCliWorkspaceComposition({
      cwd,
      userHome,
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    });

    expect(composition.projectAccess.status).toBe('restricted');
    expect(composition.contributionSources.map((source) => source.kind)).toEqual(['host']);
    expect(composition.skillRoots).toBe(ROBOTA_SKILL_ROOTS);
    expect(
      new SkillCommandSource(composition.contributionSources, composition.skillRoots).getCommands(),
    ).toEqual([]);
    expect(composition.settingsSources.map((source) => source.kind)).toEqual(['host', 'host']);
    expect(composition.settingsStores.map((store) => store.kind)).toEqual(['host']);
    expect(composition.memoryStore).toBeUndefined();

    composition.sessionStore.save({
      id: 'restricted-session',
      cwd,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      messages: [],
    });
    expect(readdirSync(join(userHome, '.robota', 'sessions')).length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ROBOTA_PROJECT_STATE_DIRECTORIES.sessions))).toBe(false);
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'derives project readers and state only from the supplied trusted authority',
    async () => {
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
      expect(
        (() => {
          const o = composition.sessionStore.load('trusted-session');
          return o.status === 'valid' ? o.record.cwd : undefined;
        })(),
      ).toBe(cwd);
      const preview = listProjectContributionPaths('');
      for (const [namespace, relativePath] of Object.entries(ROBOTA_PROJECT_STATE_DIRECTORIES)) {
        expect(preview.find((entry) => entry.id === `state:${namespace}`)?.relativePath).toBe(
          relativePath,
        );
        expect(
          getWorkspaceProjectStateStorage(
            access.authority,
            namespace as keyof typeof ROBOTA_PROJECT_STATE_DIRECTORIES,
          ).rootRelativePath,
        ).toBe(relativePath);
      }
      expect(readdirSync(join(cwd, ROBOTA_PROJECT_STATE_DIRECTORIES.sessions))).toContain(
        'trusted-session.json',
      );
    },
  );

  it('refuses trusted project access minted for a different CLI workspace root', async () => {
    const trustedRoot = tempRoot('robota-cli-trusted-root-');
    const cwd = tempRoot('robota-cli-other-root-');
    const userHome = tempRoot('robota-cli-other-root-user-');
    const access = await trustedAccess(trustedRoot);

    expect(() => createCliWorkspaceComposition({ cwd, userHome, projectAccess: access })).toThrow(
      'Trusted project access does not cover the requested working directory.',
    );
  });

  it('refuses an externally minted authority with state roots that disagree with preview', async () => {
    const cwd = tempRoot('robota-cli-state-root-mismatch-');
    const userHome = tempRoot('robota-cli-state-root-user-');
    const access = await trustedAccess(cwd, {
      ...ROBOTA_PROJECT_STATE_DIRECTORIES,
      sessions: join('.other', 'sessions'),
    });

    expect(() => createCliWorkspaceComposition({ cwd, userHome, projectAccess: access })).toThrow(
      'Trusted project state directories do not match this CLI product.',
    );
  });

  it('accepts an in-root CLI descendant whose name begins with two dots', async () => {
    const trustedRoot = tempRoot('robota-cli-descendant-root-');
    const cwd = join(trustedRoot, '..cache');
    mkdirSync(cwd);
    const userHome = tempRoot('robota-cli-descendant-user-');
    const access = await trustedAccess(trustedRoot);

    expect(
      createCliWorkspaceComposition({ cwd, userHome, projectAccess: access }).projectAccess,
    ).toBe(access);
  });

  it('adds a project settings store only with a writer minted for the same authority', async () => {
    const cwd = tempRoot('robota-cli-project-settings-');
    const userHome = tempRoot('robota-cli-project-settings-user-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');
    const writer = createWorkspaceProjectSettingsWriter(access.authority, {
      status: 'approved',
      target: 'project-local',
      relativePath: join('.robota', 'settings.local.json'),
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
