import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceTrustService,
  createNodeHostSettingsSource,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
  type IWorkspaceIdentity,
  type TSettingsSource,
} from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commandEnvironment,
  commandEnvironmentAllowList,
  providerCredentialVariables,
  withholdProviderCredentials,
} from '../command-environment.js';
import { productProjectSettings } from '../project-settings.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

/** Issue #3429 — the runtime's own provider credentials leave the environment commands inherit. */
const definitions = [
  { type: 'openai', defaults: { apiKey: '$ENV:OPENAI_API_KEY' } },
  { type: 'local', defaults: {} },
] as unknown as IProviderDefinition[];

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-command-env-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function userSource(settings: object): TSettingsSource {
  const path = join(root, 'user-settings.json');
  writeFileSync(path, JSON.stringify(settings));
  return createNodeHostSettingsSource('user', path);
}

/** A trusted project's settings layers, minted through the real trust-service path. */
async function projectSources(settings: object): Promise<readonly TSettingsSource[]> {
  const project = join(root, 'project');
  const runtime = createTestProductRuntime();
  mkdirSync(join(project, runtime.layout.projectDirectory), { recursive: true });
  writeFileSync(join(project, runtime.layout.projectDirectory, 'settings.json'), JSON.stringify(settings));
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${project}`,
    displayPath: project,
    worktreeRoot: project,
  };
  const service = new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => ({ state: 'trusted', generation: 1 }),
      grant: async () => ({ state: 'trusted', generation: 1 }),
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  });
  const access = await service.inspect(project);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return createWorkspaceProjectSettingsSources(
    getWorkspaceProjectReader(access.authority),
    productProjectSettings(runtime),
  );
}

describe('provider credential variables', () => {
  it('collects every profile reference and every definition default, never a literal key', () => {
    const sources = [
      userSource({
        provider: { name: 'openai', apiKey: '$ENV:LEGACY_KEY' },
        providers: {
          a: { type: 'openai', apiKey: '$ENV:TEAM_OPENAI_KEY' },
          b: { type: 'openai', apiKey: 'sk-literal' },
          c: { type: 'openai', apiKey: '$ENV:not a name' },
        },
      }),
    ];
    expect(providerCredentialVariables(sources, definitions)).toEqual([
      'LEGACY_KEY',
      'OPENAI_API_KEY',
      'TEAM_OPENAI_KEY',
    ]);
  });

  it('removes them from the environment and keeps everything else', () => {
    const sources = [userSource({ providers: { a: { type: 'openai', apiKey: '$ENV:TEAM_KEY' } } })];
    const environment: NodeJS.ProcessEnv = { TEAM_KEY: 't', OPENAI_API_KEY: 'o', PATH: '/bin' };
    expect(withholdProviderCredentials(sources, definitions, environment)).toEqual([
      'OPENAI_API_KEY',
      'TEAM_KEY',
    ]);
    expect(environment).toEqual({ PATH: '/bin' });
  });

  it('denies a command started from the startup snapshot what it withheld', () => {
    const sources = [userSource({ providers: { a: { type: 'openai', apiKey: '$ENV:SNAPSHOT_KEY' } } })];
    withholdProviderCredentials(sources, definitions, {});
    expect(commandEnvironment({ SNAPSHOT_KEY: 's', OPENAI_API_KEY: 'o', PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });

  it('keeps a variable the owner opted in', () => {
    const sources = [userSource({ commandEnvAllow: ['OPENAI_API_KEY'] })];
    const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'o' };
    withholdProviderCredentials(sources, definitions, environment);
    expect(environment).toEqual({ OPENAI_API_KEY: 'o' });
  });

  it('ignores an opt-in from project settings', async () => {
    const project = await projectSources({ commandEnvAllow: ['OPENAI_API_KEY'] });
    const sources = [userSource({}), ...project];
    expect(project.length).toBeGreaterThan(0);
    expect([...commandEnvironmentAllowList(sources)]).toEqual([]);
    // The project layer is really read: its provider reference is collected like any other.
    const referencing = await projectSources({ providers: { p: { type: 'openai', apiKey: '$ENV:PROJECT_KEY' } } });
    expect(providerCredentialVariables(referencing, [])).toEqual(['PROJECT_KEY']);
    const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'o' };
    withholdProviderCredentials(sources, definitions, environment);
    expect(environment).toEqual({});
  });
});
